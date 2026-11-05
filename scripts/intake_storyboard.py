#!/usr/bin/env python3
"""Read-only intake of explicit storyboard JSON; never commits upstream state."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
sys.dont_write_bytecode = True
from upstream_contract import (ADAPTER_VERSION, STATE_PROFILE, collect_transition_context,
                               resolve_script_reference, scope_diagnostics, upstream_provenance)


def reject_constant(value):
    raise ValueError(f"Non-finite JSON value: {value}")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(file):
    return json.loads(file.read_text(encoding="utf-8-sig"),
                      parse_constant=reject_constant, object_pairs_hook=unique_object)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def local_ref(ref, base):
    require(isinstance(ref, str) and ref.strip(), "A nonempty local source reference is required.")
    raw, _, fragment = ref.partition("#")
    require(not re.match(r"^(https?|chat|conversation|user-message):", raw, re.I),
            f"Save/read the actual referenced content explicitly before CLI intake: {ref}")
    file = Path(raw)
    file = file.resolve() if file.is_absolute() else (base / file).resolve()
    require(file.is_file(), f"Referenced file is missing: {file}")
    return file, fragment


def section_text(text, fragment):
    if not fragment:
        return text
    anchor = re.search(r'<a\s+id=["\']' + re.escape(fragment) + r'["\']\s*>\s*</a>', text, re.I)
    if anchor:
        start = anchor.end()
        heading = re.match(r"\s*(#{1,6})[ \t]+[^\r\n]+(?:\r?\n|$)", text[start:])
        if heading:
            search_start = start + heading.end()
            boundary = re.search(r"(?m)^#{1," + str(len(heading[1])) + r"}[ \t]+", text[search_start:])
            if not boundary:
                return text[start:]
            end = search_start + boundary.start()
            # An incoming section anchor belongs to the next heading, not this one.
            for previous in re.finditer(r'<a\s+id=["\'][^"\']+["\']\s*>\s*</a>', text[start:end], re.I):
                if not text[start + previous.end():end].strip():
                    end = start + previous.start()
                    break
            return text[start:end]
        next_anchor = re.search(r'<a\s+id=', text[start:], re.I)
        return text[start:start + next_anchor.start()] if next_anchor else text[start:]
    for match in re.finditer(r"(?m)^(#{1,6})\s+(.+?)\s*$", text):
        slug = re.sub(r"[^\w\- ]", "", match[2].lower()).replace(" ", "-")
        if fragment in (match[2], slug):
            rest = text[match.end():]
            boundary = re.search(r"(?m)^#{1," + str(len(match[1])) + r"}\s+", rest)
            selected = rest[:boundary.start()] if boundary else rest
            if boundary:
                for previous in re.finditer(r'<a\s+id=["\'][^"\']+["\']\s*>\s*</a>', selected, re.I):
                    if not selected[previous.end():].strip():
                        return selected[:previous.start()]
            return selected
    raise ValueError(f"Cannot unambiguously locate Markdown fragment #{fragment}; use a dedicated mother-script file.")


def state_scope(state, formal_id, profile=STATE_PROFILE):
    """Only facts that can invalidate this formal segment, not workflow progress."""
    require(profile in ("SCOPED_STATE_V2", STATE_PROFILE), "Unsupported scoped state validation profile.")
    rows = [row for row in state.get("coverage_ledger", []) if row.get("formal_id") == formal_id]
    require(len(rows) == 1 and rows[0].get("status") == "DONE", "Target no longer has one current DONE coverage record.")
    coverage = rows[0]
    script = state.get("source_script_ref")
    require(isinstance(script, dict) and isinstance(script.get("version"), str) and script["version"],
            "Source version is missing; explicitly recover source_script_ref.version from the actual upstream evidence.")
    require(coverage.get("source_script_version") == script["version"],
            "Target coverage source_script_version differs from source_script_ref.version (or is missing); refresh/recover the correct upstream lineage.")
    require("start_state" in coverage and "end_state" in coverage, "Target start_state/end_state evidence is missing.")
    prompts = [row for row in state.get("prompt_versions", []) if row.get("formal_id") == formal_id and row.get("prompt_version") == coverage.get("prompt_version")]
    require(len(prompts) == 1 and prompts[0].get("status") == "DONE", "Target mother-script version is no longer effective.")
    prompt = prompts[0]
    require(prompt.get("budget_version") == coverage.get("budget_version"), "Target prompt/coverage budget lineage differs.")
    require(prompt.get("budget_status") in ("CHECKED", "FROZEN"), "Target budget is no longer checked/frozen.")
    require(prompt.get("delivery_ref") == coverage.get("delivery_ref"), "Target delivery lineage differs.")
    text_check = coverage.get("checks", {}).get("TEXT", {})
    require(text_check.get("status") == "PASS" and isinstance(text_check.get("evidence"), str) and text_check["evidence"].strip(), "Target TEXT evidence is no longer valid.")
    steps = [row for row in state.get("step_ledger", []) if row.get("step_id") == formal_id and not row.get("request_id") and row.get("status") in ("DONE", "REUSED") and row.get("prompt_version", coverage["prompt_version"]) == coverage["prompt_version"]]
    require(steps, "Target has no matching completed step evidence.")
    for item in state.get("blocking_items", []):
        if profile == STATE_PROFILE and item.get("request_id") and formal_id not in item.get("blocks", []):
            continue
        blocks = item.get("blocks", [])
        require(formal_id not in blocks and "*" not in blocks and item.get("step_id") != formal_id, "A current blocker applies to this target.")
    require(state.get("edit_lock") not in (formal_id, coverage.get("segment_id")) or state.get("edit_lock") in (None, "NONE"), "Target is edit-locked.")

    def pick(record, names):
        return {name: record[name] for name in names if name in record}

    settings = {}
    for key in ("video_aspect_ratio", "visual_style", "segment_max_s"):
        item = state.get("production_settings", {}).get(key, {})
        require(item.get("status") == "CONFIRMED" and item.get("decision_ref") and item.get("selected") is not None, f"{key} is no longer confirmed.")
        settings[key] = pick(item, ("selected", "status", "decision_ref"))
    return {
        "profile": profile, "project_id": state.get("project_id"),
        "state_version": state.get("state_version"), "workflow_schema": state.get("workflow_schema"),
        "production_settings": settings, "source_script_ref": script,
        "coverage": {**pick(coverage, ("formal_id", "episode_id", "scene_id", "segment_id", "prompt_version", "budget_version", "source_script_version", "chains", "start_cursor", "end_cursor", "start_anchor", "end_anchor", "start_state", "end_state", "delivery_ref", "status")), "TEXT": pick(text_check, ("status", "scope", "evidence") if profile == STATE_PROFILE else ("status", "evidence"))},
        "prompt": pick(prompt, ("formal_id", "prompt_version", "budget_version", "budget_status", "budget_ref", "delivery_ref", "status")),
        "steps": [pick(row, ("step_id", "status", "prompt_version", "delivery_ref")) for row in steps]
    }


def prepare(state_path, budget_path, formal_id, out_path, additional_sources=(), upstream_skill_dir=None):
    state = read_json(state_path)
    require(isinstance(state, dict), "State must be an explicit JSON object; free text requires manual intake.")
    schemas = {"1.8": "SINGLE_TEXT_CONFIRMED_ASSET_STAGES_V3", "1.9": "SINGLE_TEXT_CONFIRMED_ASSET_STAGES_V4"}
    require(state.get("state_version") in schemas, "Unsupported state version; read and map its actual schema explicitly.")
    require(state.get("workflow_schema") == schemas[state["state_version"]], "State version/schema mismatch.")
    require(isinstance(state.get("project_id"), str) and state["project_id"].strip(), "project_id is required.")
    base = state_path.parent
    if state.get("state_ref"):
        declared, _ = local_ref(state["state_ref"], base)
        require(declared == state_path, "state_ref does not identify this input; do not use an archived snapshot as authority.")
    settings = state.get("production_settings", {})
    for key in ("video_aspect_ratio", "visual_style", "segment_max_s"):
        item = settings.get(key, {})
        require(item.get("status") == "CONFIRMED" and bool(item.get("decision_ref")), f"{key} is not confirmed with an explicit decision reference.")
        require(item.get("selected") is not None, f"{key}: selected value is missing.")
    require(isinstance(settings["video_aspect_ratio"]["selected"], str), "Aspect ratio must be explicit.")
    require(bool(settings["visual_style"]["selected"]), "Confirmed visual style must contain the actual adopted content.")
    maximum = settings["segment_max_s"]["selected"]
    maximum = maximum.get("value") if isinstance(maximum, dict) else maximum
    require(finite(maximum) and maximum > 0, "Invalid confirmed segment duration limit.")
    coverage = [row for row in state.get("coverage_ledger", []) if row.get("formal_id") == formal_id]
    require(len(coverage) == 1 and coverage[0].get("status") == "DONE", "Target needs one current DONE coverage record; a plan or invalid/draft mother script is insufficient.")
    coverage = coverage[0]
    script_file, script_fragment, resolved_script = resolve_script_reference(state.get("source_script_ref"), base, local_ref)
    scoped_state = state_scope(state, formal_id)
    records = [row for row in state.get("prompt_versions", []) if row.get("formal_id") == formal_id and row.get("prompt_version") == coverage.get("prompt_version")]
    require(len(records) == 1 and records[0].get("status") == "DONE", "Effective mother-script version must match the current coverage record.")
    prompt = records[0]
    require(prompt.get("budget_status") in ("CHECKED", "FROZEN"), "The associated budget is not checked/frozen.")
    require(prompt.get("budget_version") == coverage.get("budget_version"), "Budget version differs between prompt and coverage.")
    require(prompt.get("delivery_ref") == coverage.get("delivery_ref"), "Mother-script delivery reference differs from current coverage.")
    check = coverage.get("checks", {}).get("TEXT", {})
    require(check.get("status") == "PASS" and isinstance(check.get("evidence"), str) and check["evidence"].strip(), "Current TEXT evidence is missing; semantic validity cannot be invented by the adapter.")
    require(any(row.get("step_id") == formal_id and row.get("status") in ("DONE", "REUSED") for row in state.get("step_ledger", [])), "No completed upstream step evidence for this formal segment.")
    lock = state.get("edit_lock")
    require(lock not in (formal_id, coverage.get("segment_id")) or lock in (None, "NONE"), "This target is currently edit-locked.")
    for item in state.get("blocking_items", []):
        if item.get("request_id") and formal_id not in item.get("blocks", []):
            continue  # A request wildcard does not include an explicitly blocked formal.
        blocks = item.get("blocks", [])
        require(formal_id not in blocks and "*" not in blocks and item.get("step_id") != formal_id, f"A current blocker applies to {formal_id}: {item.get('gap', item)}")
    budgets = read_json(budget_path)
    budgets = budgets if isinstance(budgets, list) else [budgets]
    candidates = [b for b in budgets if isinstance(b, dict) and b.get("formal_id") == formal_id and b.get("prompt_version") == prompt["prompt_version"] and b.get("budget_version") == prompt["budget_version"]]
    require(len(candidates) == 1, "Expected exactly one budget for this formal/prompt/budget version.")
    budget = candidates[0]
    require(budget.get("time_basis") == "SEGMENT", "Budget timestamps must be relative to the formal segment, not shot-local or scene-global.")
    duration = budget.get("duration_s")
    require(finite(duration) and 0 < duration <= maximum, "Segment duration is invalid or exceeds the confirmed limit.")
    require(finite(budget.get("target_max_s")) and abs(budget["target_max_s"] - maximum) < 1e-6, "Budget limit differs from the confirmed production setting.")
    previous, shot_ids = 0, set()
    for shot in budget.get("shots", []):
        require(isinstance(shot.get("id"), str) and shot["id"] and shot["id"] not in shot_ids, "Budget shot IDs must be nonempty and unique.")
        shot_ids.add(shot["id"])
        start, end, length = shot.get("start_s"), shot.get("end_s"), shot.get("duration_s")
        require(all(finite(v) for v in (start, end, length)) and end > start and abs(start-previous) < 1e-6 and abs(end-start-length) < 1e-6, f"Invalid/overlapping/gapped shot timing: {shot['id']}")
        previous = end
    require(shot_ids and abs(previous-duration) < 1e-6, "Budget shots do not cover the declared duration.")
    if prompt.get("budget_ref"):
        declared, _ = local_ref(prompt["budget_ref"], base)
        require(declared == budget_path, "Explicit budget input differs from the effective prompt budget_ref.")
    master_file, fragment = local_ref(prompt["delivery_ref"], base)
    master = section_text(master_file.read_text(encoding="utf-8-sig"), fragment)
    start = master.find("场《")
    require(start >= 0, "The referenced artifact lacks the complete mother-script opening; summary/test prompts are not production input.")
    master = master[start:]
    for marker in ("【全片风格】", "【整体描述】", "【禁止项】"):
        require(marker in master, f"Mother-script structure is incomplete: {marker}")
    total = re.search(r"总时长\s*[:：]\s*([\d.]+)\s*秒", master)
    require(total and abs(float(total[1])-duration) < 1e-6, "Mother-script duration differs from the associated budget.")
    require("时间码均相对本段0秒" in master.replace(" ", ""), "Mother-script time basis must be explicit.")
    blocks = re.split(r"镜头(?:[一二三四五六七八九十百零〇]+|\d+)\s*[{｛]", master)[1:]
    require(len(blocks) == len(budget["shots"]), "Mother-script shot count differs from the budget; continuous phases must not become cuts.")
    for block, shot in zip(blocks, budget["shots"]):
        interval = re.search(r"时间\s*[:：]\s*([\d.]+)\s*[-–—~～至]\s*([\d.]+)\s*秒", block)
        require(interval and abs(float(interval[1])-shot["start_s"]) < 1e-6 and abs(float(interval[2])-shot["end_s"]) < 1e-6, f"Mother-script/budget shot interval mismatch: {shot['id']}")
    sources = []

    def add_source(role, file, *, fragment="", selected_value=None):
        try:
            source_path = os.path.relpath(file, out_path.parent).replace(os.sep, "/")
            path_kind = "RELATIVE_REFERENCE"
        except ValueError:
            # Windows projects may legitimately read upstream material from another drive.
            source_path = file.resolve().as_posix()
            path_kind = "ABSOLUTE_LIVE_REFERENCE"
        item = {"role": role, "path": source_path, "path_kind": path_kind, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}
        if selected_value is not None:
            item["selector"] = {"kind": "JSON_BUDGET_V1", **{key: selected_value[key] for key in ("formal_id", "prompt_version", "budget_version")}}
            item["selected_value"] = selected_value
        elif fragment:
            selected = section_text(file.read_text(encoding="utf-8-sig"), fragment).strip()
            require(selected, f"Selected {role} fragment is empty: #{fragment}")
            item["selector"] = {"kind": "MARKDOWN_FRAGMENT_V1", "fragment": fragment, "normalization": "LF_STRIP_BOUNDARY_WHITESPACE"}
            item["selected_sha256"] = hashlib.sha256(selected.encode("utf-8")).hexdigest()
        sources.append(item)

    add_source("state", state_path)
    add_source("budget", budget_path, selected_value=budget)
    add_source("master", master_file, fragment=fragment)
    evidence, evidence_fragment = local_ref(check["evidence"], base)
    add_source("text_evidence", evidence, fragment=evidence_fragment)
    add_source("source_script", script_file, fragment=script_fragment)
    for item in additional_sources:
        role, separator, reference = item.partition('=')
        require(separator and role in ('asset_prompt', 'scene_analysis', 'supporting_material'), 'Additional --source must use asset_prompt=path, scene_analysis=path or supporting_material=path.')
        extra_file, extra_fragment = local_ref(reference, base)
        require(not extra_fragment, 'Additional material currently uses a dedicated whole-file source; save the actual selected material in its own evidence file when needed.')
        add_source(role, extra_file)
    snapshot_keys = ("state_version", "workflow_schema", "source_script_ref", "project_decisions", "character_profiles", "character_assets", "scene_assets", "prop_assets", "characters_state", "environment_state", "weapons_props_state", "viewing_state", "ongoing_effects_state", "last_frame_snapshot")
    return {
        "schema_version": "STORYBOARD_PREVIS_ADAPTER_V1", "adapter_version": ADAPTER_VERSION, "input_mode": "STATE_JSON",
        "project_id": state["project_id"], "formal_id": formal_id, "prompt_version": prompt["prompt_version"], "budget_version": prompt["budget_version"],
        "episode_id": coverage.get("episode_id"), "scene_id": coverage.get("scene_id"),
        "production_settings": settings, "budget": budget, "master": {"ref": prompt["delivery_ref"], "text": master, "text_sha256": hashlib.sha256(master.encode('utf-8')).hexdigest()},
        "sources": sources, "state_scope": scoped_state, "validation_profile": STATE_PROFILE,
        "resolved_source_script_ref": resolved_script, "diagnostics": scope_diagnostics(state, formal_id),
        "transition_context": collect_transition_context(state, formal_id, prompt["prompt_version"], sources[0]["path"]),
        "upstream_provenance": upstream_provenance(upstream_skill_dir),
        "upstream_snapshot": {**{k: state.get(k) for k in snapshot_keys}, "coverage": coverage},
        "semantic_review": "NOT_RUN", "upstream_writes": False,
        "scope": "Read-only structural intake; does not verify narrative semantics, speech completeness or authenticity of decisions."
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", required=True, type=Path)
    parser.add_argument("--budget", required=True, type=Path)
    parser.add_argument("--formal-id", required=True)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument('--source', action='append', default=[], help='Explicit target-only extra evidence, e.g. asset_prompt=assets.md; relative to the upstream state directory.')
    parser.add_argument("--upstream-skill-dir", type=Path, help="Actual script-to-storyboard-prompts package directory; provenance metadata only, UNKNOWN when omitted.")
    args = parser.parse_args()
    try:
        out = args.out.resolve()
        require(not out.exists(), "Intake output already exists; use a new adapter revision rather than silently overwriting provenance.")
        packet = prepare(args.state.resolve(), args.budget.resolve(), args.formal_id, out, args.source, args.upstream_skill_dir)
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(packet, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
        print(json.dumps({"ok": True, "output": str(out), "formal_id": packet["formal_id"], "semantic_review": "NOT_RUN", "upstream_writes": False}, ensure_ascii=False))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error), "upstream_writes": False}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
