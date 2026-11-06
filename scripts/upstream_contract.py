"""Read-only upstream 0.4.1 contracts shared by the intake CLIs.

Transition dependencies are separate from core authority. Source locations and
skill-package provenance are evidence metadata, never global invalidation keys.
"""
import copy
import hashlib
import json
import math
import re
import struct
import subprocess
from pathlib import Path

ADAPTER_VERSION = "0.6.1"
STATE_PROFILE = "SCOPED_STATE_V3"
TRANSITION_SCHEMA = "PREVIS_TRANSITION_CONTEXT_V1"
TRANSITION_HASH_PROFILE = "PREVIS_TRANSITION_DEPENDENCIES_V1"


def resolve_script_reference(script, base, resolve_ref):
    """Resolve both aliases without editing the authority or guessing a winner."""
    if not isinstance(script, dict):
        raise ValueError("source_script_ref must be an object with path or location and an explicit version.")
    aliases = {key: script[key] for key in ("path", "location") if key in script}
    if not aliases:
        raise ValueError("source_script_ref.path or source_script_ref.location is required; neither field is present.")
    resolved = {}
    for key, value in aliases.items():
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"source_script_ref.{key} must be a nonempty local reference.")
        try:
            resolved[key] = resolve_ref(value, base)
        except (ValueError, OSError) as error:
            raise ValueError(f"source_script_ref.{key}: {error}") from error
    if len(resolved) == 2 and resolved["path"] != resolved["location"]:
        raise ValueError("source_script_ref.path and source_script_ref.location conflict: they resolve to different files or Markdown fragments.")
    file, fragment = next(iter(resolved.values()))
    return file, fragment, {"aliases": copy.deepcopy(aliases), "resolved_path": file.as_posix(), "fragment": fragment}


def scope_diagnostics(state, formal_id):
    diagnostics = []
    for index, row in enumerate(state.get("coverage_ledger", [])):
        if row.get("formal_id") == formal_id and "scope" not in row.get("checks", {}).get("TEXT", {}):
            diagnostics.append({"code": "TEXT_SCOPE_NOT_DECLARED", "path": f"/coverage_ledger/{index}/checks/TEXT", "message": "Historical TEXT evidence has no scope. Its recorded status is retained; no missing scope or local semantic/media PASS is invented."})
    for item in state.get("blocking_items", []):
        if item.get("request_id") and formal_id not in item.get("blocks", []):
            diagnostics.append({"code": "REQUEST_SCOPED_BLOCKER", "blocker": copy.deepcopy(item), "message": "This blocker belongs to a separate upstream request. It is retained as evidence and does not block local previs of an effective mother script."})
    return diagnostics


def _tagged(value):
    """Typed canonical JSON makes Python/JS hashes equal for JSON numbers.

    Numbers use their binary64 representation (as in the JS authority reader),
    avoiding 9 versus 9.0, exponent spelling and negative-zero differences.
    Every value has a type tag, so source objects cannot collide with a tag.
    """
    if value is None:
        return ["null"]
    if isinstance(value, bool):
        return ["boolean", value]
    if isinstance(value, (int, float)):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("Transition dependencies contain a non-finite JSON number.")
        return ["number", struct.pack(">d", 0.0 if number == 0 else number).hex()]
    if isinstance(value, str):
        return ["string", value]
    if isinstance(value, list):
        return ["array", [_tagged(item) for item in value]]
    if isinstance(value, dict):
        # UTF-8 byte order is identical across runtimes, including non-BMP keys.
        return ["object", [[key, _tagged(value[key])] for key in sorted(value, key=lambda item: item.encode("utf-8"))]]
    raise ValueError("Transition dependencies must contain only JSON values.")


def transition_context_sha256(context):
    selected = {key: context[key] for key in ("schema_version", "formal_id", "prompt_version", "plans", "reviews", "endpoint_dependencies")}
    encoded = json.dumps(_tagged(selected), ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def boundary_matches(declared, current):
    """Delivery adds source/viewing annotations to an earlier physical plan.

    Only these known optional annotations may be absent from the plan. Every
    declared field and every other actual field must still match exactly.
    The full current boundary is retained in the dependency fingerprint.
    """
    if declared is None or declared == {} or declared == "":
        return False
    if isinstance(declared, dict) and isinstance(current, dict):
        current = {key: value for key, value in current.items() if key not in ("source", "viewing") or key in declared}
    return _tagged(declared) == _tagged(current)


def collect_transition_context(state, formal_id, prompt_version, source_ref=None):
    """Keep exact version-bound records; never promote a plan into delivery.

    Older unversioned plans may bind through their actual boundary state. This
    evidence is recorded explicitly; a missing version is never labelled PASS.
    """
    context = {"schema_version": TRANSITION_SCHEMA, "formal_id": formal_id, "prompt_version": prompt_version,
               "plans": [], "reviews": [], "endpoint_dependencies": [], "source_locations": [], "diagnostics": [],
               "hash_profile": TRANSITION_HASH_PROFILE}
    if source_ref is not None:
        context["source_ref"] = source_ref
    coverage_rows = state.get("coverage_ledger", [])
    if not coverage_rows and isinstance(state.get("coverage"), dict):
        coverage_rows = [state["coverage"]]  # Explicit manual snapshot, not recovered authority.
    delivered = {}
    for row in coverage_rows:
        if row.get("status") == "DONE":
            delivered.setdefault(row.get("formal_id"), []).append(row)
    delivered = {key: rows[0] for key, rows in delivered.items() if len(rows) == 1}
    planned = {}
    plan_rows = state.get("segment_plan", [])
    if not isinstance(plan_rows, list):
        context["diagnostics"].append({"code": "UNSUPPORTED_SEGMENT_PLAN_COLLECTION", "path": "/segment_plan", "message": "Expected an explicit segment plan list; no endpoint plan versions were guessed."})
        plan_rows = []
    for row in plan_rows:
        if isinstance(row, dict) and row.get("status") != "INVALID":
            planned.setdefault(row.get("formal_id"), []).append(row)
    planned = {key: rows[0] for key, rows in planned.items() if len(rows) == 1}

    def endpoint(record, side):
        value = record.get(side)
        nested = value if isinstance(value, dict) else {}
        return (nested.get("formal_id", nested.get("id")) if nested else value,
                record.get(side + "_prompt_version", nested.get("prompt_version")),
                record.get(side + "_plan_version", nested.get("plan_version")))

    def bind(record, side, collection):
        target, version, plan_version = endpoint(record, side)
        if not isinstance(target, str) or not target:
            return None
        current, plan = delivered.get(target), planned.get(target)
        boundary_key = "end_state" if side == "from" else "start_state"
        boundary = record.get("previous_end_state" if side == "from" else "next_start_state")
        if plan_version is not None and (not plan or plan_version != plan.get("plan_version")):
            return None
        if current:
            if version is not None:
                if version != current.get("prompt_version"):
                    return None
                basis = "EXPLICIT_PROMPT_VERSION"
            elif collection == "transition_plan" and boundary_matches(boundary, current.get(boundary_key)):
                basis = "MATCHING_BOUNDARY_STATE"
            else:
                return None
            return {"formal_id": target, "prompt_version": current.get("prompt_version"), "delivery_status": "DONE",
                    "source_script_version": current.get("source_script_version"), "boundary_state": copy.deepcopy(current.get(boundary_key)), "binding_basis": basis}
        # Only an explicitly planned endpoint, or an unversioned plan with an
        # actual matching planned boundary, can refer to an undelivered formal.
        if plan_version is not None:
            if not plan or plan_version != plan.get("plan_version"):
                return None
            basis = "EXPLICIT_PLAN_VERSION"
        elif collection == "transition_plan" and plan and boundary_matches(boundary, plan.get(boundary_key)):
            basis = "MATCHING_PLANNED_BOUNDARY_STATE"
        elif version is not None and (record.get("status") == "PLANNED" or record.get("actual_next_formal_delivered") is False):
            basis = "DECLARED_FUTURE_PROMPT_VERSION"
        else:
            return None
        result = {"formal_id": target, "delivery_status": "PLANNED", "binding_basis": basis}
        if plan and "plan_version" in plan:
            result["plan_version"] = plan["plan_version"]
        if version is not None:
            result["prompt_version"] = version
        if plan and boundary_key in plan:
            result["boundary_state"] = copy.deepcopy(plan[boundary_key])
        return result

    for collection, output in (("transition_plan", "plans"), ("transition_review", "reviews")):
        rows = state.get(collection, [])
        if not isinstance(rows, list):
            context["diagnostics"].append({"code": "UNSUPPORTED_TRANSITION_COLLECTION", "path": "/" + collection, "message": "Expected the upstream transition list; no records were guessed."})
            continue
        for index, record in enumerate(rows):
            if not isinstance(record, dict):
                continue
            pair = {side: endpoint(record, side)[0] for side in ("from", "to")}
            own = record.get("formal_id") == formal_id
            related = own or formal_id in pair.values()
            if not related:
                continue
            if record.get("status") == "INVALID" or record.get("review_status") == "INVALID":
                continue  # Invalidated history is not an active connection.
            dependencies = {}
            if own:
                if record.get("prompt_version") != prompt_version:
                    continue
                dependencies["formal"] = {"formal_id": formal_id, "prompt_version": prompt_version}
            if formal_id in pair.values():
                dependencies.update({side: bind(record, side, collection) for side in ("from", "to")})
                if any(value is None for value in dependencies.values()):
                    context["diagnostics"].append({"code": "TRANSITION_VERSION_NOT_CURRENT", "path": f"/{collection}/{index}", "message": "Endpoint versions/boundary evidence do not bind to the current delivery or current plan; record omitted."})
                    continue
                if any(value["formal_id"] == formal_id and value.get("prompt_version") != prompt_version for value in dependencies.values()):
                    continue
            selected_index = len(context[output])
            context[output].append(copy.deepcopy(record))
            context["endpoint_dependencies"].append({"collection": output, "record_index": selected_index, "endpoints": dependencies})
            context["source_locations"].append({"collection": output, "record_index": selected_index, "pointer": f"/{collection}/{index}"})
            if any(item.get("delivery_status") == "PLANNED" for item in dependencies.values()):
                context["diagnostics"].append({"code": "TRANSITION_ENDPOINT_NOT_DELIVERED", "path": f"/{collection}/{index}", "message": "A selected endpoint is only planned. The original record is retained; delivery and media checks are not promoted."})
    context["sha256"] = transition_context_sha256(context)
    return context


def upstream_provenance(skill_dir=None):
    """Package documents are forensic metadata, not this formal's core facts."""
    result = {"schema_version": "PREVIS_UPSTREAM_PROVENANCE_V1", "skill_name": "script-to-storyboard-prompts", "skill_version": "UNKNOWN", "git_commit": "UNKNOWN", "documents": [], "scope": "PACKAGE_EVIDENCE_ONLY"}
    if skill_dir is None:
        result["status"] = "NOT_PROVIDED"
        return result
    directory = Path(skill_dir).resolve()
    entry = directory / "SKILL.md"
    if not directory.is_dir() or not entry.is_file():
        raise ValueError(f"--upstream-skill-dir must identify the actual package directory containing SKILL.md: {directory}")
    content = entry.read_text(encoding="utf-8-sig")
    if not re.search(r"(?m)^name:\s*script-to-storyboard-prompts\s*$", content):
        raise ValueError("--upstream-skill-dir SKILL.md does not name script-to-storyboard-prompts.")
    version = re.search(r"技能包版本\s*[:：]\s*(\d+\.\d+\.\d+)", content) or re.search(r"(?m)^version:\s*[\"']?(\d+\.\d+\.\d+)", content)
    if version:
        result["skill_version"] = version[1]
    result.update(status="RECORDED", source_dir=directory.as_posix())
    try:
        git_root = subprocess.run(["git", "-C", str(directory), "rev-parse", "--show-toplevel"], capture_output=True, text=True, timeout=15, check=True)
        repository = Path(git_root.stdout.strip()).resolve()
        relative_entry = entry.relative_to(repository).as_posix()
        # A package copied into an unrelated checkout must not inherit that
        # checkout's commit unless its entry document is actually tracked there.
        subprocess.run(["git", "-C", str(repository), "ls-files", "--error-unmatch", "--", relative_entry], capture_output=True, text=True, timeout=15, check=True)
        git = subprocess.run(["git", "-C", str(directory), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=15, check=True)
        commit = git.stdout.strip()
        if re.fullmatch(r"[0-9a-f]{40,64}", commit):
            result["git_commit"] = commit
            result["git_root"] = repository.as_posix()
    except (OSError, ValueError, subprocess.SubprocessError):
        result["git_diagnostic"] = "No readable Git commit for this package; document hashes remain available."
    documents = [entry]
    if (directory / "README.md").is_file():
        documents.append(directory / "README.md")
    for name in ("references", "specs", "docs"):
        documents.extend(file for file in (directory / name).rglob("*.md") if file.is_file())
    result["documents"] = [{"path": file.relative_to(directory).as_posix(), "sha256": hashlib.sha256(file.read_bytes()).hexdigest()} for file in sorted(set(documents))]
    return result
