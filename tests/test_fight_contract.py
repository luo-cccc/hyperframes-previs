"""Original adapter regressions, including actual Node consumers and optional local examples.

Run: python -B -X utf8 -m unittest discover -s tests -p test_fight_contract.py -v
Set FIGHT_UPSTREAM_FIXTURES to a local examples directory to exercise upstream
archives; their text is read locally and is never installed into Git fixtures.
"""
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / 'scripts'))
import fight_contract as fight

FIXTURES = ROOT / 'tests/fixtures/fight-source'
NODE_MODULE = ROOT / 'assets/starter/scripts/fight-source.mjs'
BRIDGE = FIXTURES / 'check-source.mjs'
ARCHIVE = Path(os.environ.get('FIGHT_UPSTREAM_FIXTURES', str(ROOT / 'outputs/xianxia-adapter-review-20261106/source/examples')))


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')


def legacy(project):
    result = copy.deepcopy(project)
    result['schema_version'] = '1.1'
    result.pop('cost', None)
    result.pop('knowledge', None)
    result['scene'].pop('attrition', None)
    for row in result['beats']:
        row.pop('marks', None)
    for row in result['shots']:
        for field in ('light', 'risk', 'fallback'):
            row.pop(field, None)
        row['execution'].pop('light', None)
    for row in result['keyframes']:
        row.pop('role', None)
    return result


class FightFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='fight-contract-')
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.project = fight.read_json(FIXTURES / 'synthetic-1.2.json')
        self.source = self.work / '原创 源.json'
        self.packet_file = self.work / 'unit/upstream-intake.json'
        self.write_source()

    def write_source(self, value=None):
        self.source.write_bytes(json_bytes(self.project if value is None else value))

    def packet(self, segment='sy_unit_b', **kwargs):
        packet = fight.create_packet(self.source, segment, self.packet_file, **kwargs)
        self.packet_file.parent.mkdir(parents=True, exist_ok=True)
        self.packet_file.write_bytes(json_bytes(packet))
        return packet

    def node(self, expected=True, **options):
        options_file = self.work / 'options.json'
        options_file.write_bytes(json_bytes(options))
        result = subprocess.run(['node', str(BRIDGE), str(NODE_MODULE), str(self.work), str(self.packet_file.relative_to(self.work)), str(options_file)], capture_output=True, text=True, encoding='utf-8', timeout=30)
        self.assertTrue(result.stdout.strip(), result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data['ok'], expected, data)
        self.assertEqual(result.returncode == 0, expected, data)
        return data

    def cli(self, *args, good=True):
        result = subprocess.run([sys.executable, '-B', '-X', 'utf8', str(ROOT / 'scripts/intake_fight.py'), *map(str, args)], capture_output=True, text=True, encoding='utf-8', timeout=30)
        self.assertEqual(result.returncode == 0, good, result.stderr)
        return json.loads(result.stdout if good else result.stderr)

    def expect_invalid(self, mutation, match=None):
        project = copy.deepcopy(self.project)
        mutation(project)
        with self.assertRaises((fight.FightContractError, TypeError, ValueError)) as raised:
            fight.validate_project(project)
        if match:
            self.assertIn(match, str(raised.exception))

    def manual(self):
        roles = {'design': '/project/design', 'assets': '/project/assets', 'storyboard': '/project/shots', 'keyframes': '/project/keyframes', 'execution': '/project/segments', 'review': '/project/review'}
        draft = {'schema_version': 'PREVIS_FIGHT_DRAFT_V1', 'project': self.project, 'segment_id': 'sy_unit_b', 'mapping': [{'target': target, 'role': role, 'locator': 'SYNTHETIC explicitly read section: ' + role} for role, target in roles.items()], 'assumptions': ['SYNTHETIC explicit human transcription; dimensions UNKNOWN.']}
        self.source = self.work / '人工 整理.json'
        self.source.write_bytes(json_bytes(draft))
        specs = []
        for role in roles:
            file = self.work / (role + '.md')
            file.write_bytes(('SYNTHETIC original ' + role + '\r\nOriginal six-part evidence.\r\n').encode('utf-8'))
            specs.append(role + '=' + file.name)
        return draft, specs

    def manual_packet(self):
        draft, specs = self.manual()
        packet = fight.create_packet(self.source, None, self.packet_file, draft_mode=True, evidence=specs)
        self.packet_file.parent.mkdir(parents=True, exist_ok=True)
        self.packet_file.write_bytes(json_bytes(packet))
        return draft, packet, specs


class ContractValidation(FightFixture):
    def test_public_contract_fixture_12_and_original_text(self):
        self.assertIs(fight.validate_project(self.project), self.project)
        packet = self.packet()
        self.assertEqual(packet['source_snapshot'], self.project)
        self.assertEqual(packet['review'], self.project['review'])
        self.assertEqual(packet['semantic_status'], 'needs_review')
        self.assertEqual(packet['provider'], 'xianxia-fight-director')
        self.assertEqual(packet['structural_status'], 'pass')
        self.node()

    def test_legacy11_works_in_python_and_actual_node(self):
        self.project = legacy(self.project)
        self.write_source()
        packet = self.packet()
        self.assertEqual(packet['selection']['source_schema_version'], '1.1')
        self.assertNotIn('role', packet['selection']['keyframes'][0])
        self.node()

    def test_unknown_version_rejected(self):
        self.expect_invalid(lambda p: p.update(schema_version='1.0'), 'schema_version')

    def test_nonfinite_overflow_and_boolean_rejected(self):
        for bad in (True, float('inf'), float('nan'), 10**400):
            with self.subTest(value=str(bad)[:30]):
                self.expect_invalid(lambda p: p.update(duration_sec=bad))

    def test_out_of_exact_runtime_numeric_range_refuses_rounding(self):
        for value in (9007199254740992, 1e100):
            with self.subTest(value=value):
                self.expect_invalid(lambda p: p.update(duration_sec=value), 'exact JavaScript')

    def test_early_failure_writes_no_output(self):
        self.source.write_text('{"schema_version":"1.2","unknown":true}', encoding='utf-8')
        original = self.source.read_bytes()
        self.cli('--project', self.source, '--segment', 'sy_unit_b', '--out', self.packet_file, good=False)
        self.assertFalse(self.packet_file.exists())
        self.assertEqual(self.source.read_bytes(), original)

    def test_duplicate_json_keys_and_illegal_constants(self):
        for content in ('{"schema_version":"1.2","schema_version":"1.1"}', '{"duration_sec":NaN}', '{"duration_sec":Infinity}', '{"x":1e400}'):
            with self.subTest(content=content):
                self.source.write_text(content, encoding='utf-8')
                self.cli('--project', self.source, '--segment', 'sy_unit_b', '--out', self.packet_file, good=False)

    def test_invalid_utf8_rejected_without_write(self):
        self.source.write_bytes(b'{"title":"\xff"}')
        self.cli('--project', self.source, '--segment', 'sy_unit_b', '--out', self.packet_file, good=False)
        self.assertFalse(self.packet_file.exists())

    def test_node_strict_reader_rejects_invalid_input(self):
        self.packet_file.parent.mkdir(parents=True, exist_ok=True)
        for raw in (b'{"a":1,"a":2}', b'{"x":NaN}', b'{"x":1e999}', b'{"x":"\xff"}', b'[1,]', b'{"x":1} junk'):
            with self.subTest(raw=raw):
                self.packet_file.write_bytes(raw)
                self.node(False, parse_only=True)

    def test_cli_no_overwrite_existing_evidence(self):
        first = self.cli('--project', self.source, '--segment', 'sy_unit_b', '--out', self.packet_file)
        self.assertTrue(first['ok'])
        sealed = self.packet_file.read_bytes()
        self.cli('--project', self.source, '--segment', 'sy_unit_b', '--out', self.packet_file, good=False)
        self.assertEqual(self.packet_file.read_bytes(), sealed)

    def test_cli_requires_original_segment_id(self):
        for segment in (None, 'NOT_A_SEGMENT'):
            args = ['--project', self.source, '--out', self.packet_file]
            if segment is not None:
                args.extend(['--segment', segment])
            self.cli(*args, good=False)
            self.assertFalse(self.packet_file.exists())

    def test_prerequisite_must_finish_before_dependent(self):
        self.expect_invalid(lambda p: p['beats'][1].update(requires=['sy_future']), 'unfinished')

    def test_cycle_and_self_dependency_rejected(self):
        self.expect_invalid(lambda p: p['beats'][0].update(requires=['sy_breath']))

    def test_wrong_actor_kind_rejected(self):
        self.expect_invalid(lambda p: p['beats'][0].update(actors=['sy_prop']), 'character')

    def test_unknown_asset_reference_rejected(self):
        self.expect_invalid(lambda p: p['shots'][1]['asset_ids'].append('sy_missing'), 'unknown reference')

    def test_duplicate_ids_across_groups_rejected(self):
        self.expect_invalid(lambda p: p['cost'][0].update(id='sy_prop'), 'unique')

    def test_duplicate_references_rejected(self):
        self.expect_invalid(lambda p: p['shots'][1]['beat_ids'].append('sy_cross'), 'duplicate')

    def test_beats_can_cross_shots_without_splitting(self):
        packet = self.packet()
        beats = [row for row in packet['selection']['beats'] if row['id'] == 'sy_cross']
        self.assertEqual(len(beats), 1)
        self.assertEqual((beats[0]['start'], beats[0]['end']), (2, 6))
        self.assertEqual([row['id'] for row in packet['selection']['shots']], ['sy_shot_b', 'sy_shot_c'])
        self.assertEqual(packet['selection']['shots'][1]['execution']['cues'][0]['text'], self.project['shots'][2]['execution']['cues'][0]['text'])

    def test_wrong_beat_shot_association_rejected(self):
        self.expect_invalid(lambda p: p['shots'][1].update(beat_ids=['sy_future']), 'positive overlap')

    def test_missing_beat_coverage_rejected(self):
        self.expect_invalid(lambda p: p['beats'][1].update(end=7), 'coverage')

    def test_cue_gap_rejected(self):
        self.expect_invalid(lambda p: p['shots'][1]['execution']['cues'][0].update(start=2.25), 'continuously')

    def test_cue_crossing_shot_rejected(self):
        self.expect_invalid(lambda p: p['shots'][1]['execution']['cues'][0].update(end=4.1), 'outside')

    def test_doubled_time_offset_is_rejected(self):
        self.expect_invalid(lambda p: p['shots'][1]['execution']['cues'][0].update(start=0, end=2), 'outside')

    def test_local_budget_subtracts_offset_once(self):
        packet = self.packet()
        self.assertEqual(packet['unit'], {'id': 'sy_unit_b', 'battle_start_s': 2, 'battle_end_s': 6, 'duration_s': 4})
        self.assertEqual([(row['start_s'], row['end_s']) for row in packet['budget']['shots']], [(0, 2), (2, 4)])
        self.assertEqual([(row['battle_start_s'], row['battle_end_s']) for row in packet['budget']['shots']], [(2, 4), (4, 6)])
        self.assertEqual(packet['selection']['shots'][0]['execution']['cues'][0]['start'], 2)
        self.assertNotIn('formal_id', packet)
        self.assertNotIn('prompt_version', packet['lineage'])
        self.node()

    def test_both_state_layers_and_endpoint_preserved(self):
        packet = self.packet()
        state = packet['selection']['states']
        self.assertEqual(state['world']['opening_state'], self.project['shots'][1]['opening_state'])
        self.assertEqual(state['execution']['end_state'], self.project['shots'][2]['execution']['end_state'])
        endpoint = next(row for row in packet['selection']['keyframes'] if row['id'] == 'sy_handoff_b')
        self.assertEqual(endpoint['time_sec'] - packet['unit']['battle_start_s'], packet['unit']['duration_s'])
        self.assertEqual(endpoint['shot_id'], 'sy_shot_c')
        self.assertEqual(next(row for row in packet['selection']['keyframes'] if row['id'] == 'sy_handoff_a')['shot_id'], 'sy_shot_a')

    def test_keyframe_outside_closed_window_rejected(self):
        self.expect_invalid(lambda p: p['keyframes'][2].update(time_sec=4.01), 'closed')

    def test_keyframe_asset_must_be_in_own_shot(self):
        self.expect_invalid(lambda p: p['keyframes'][2]['asset_ids'].append('sy_unused'), 'owning shot')

    def test_handoff_cannot_be_reassigned_to_next_shot(self):
        self.expect_invalid(lambda p: p['keyframes'][1].update(shot_id='sy_shot_b'), 'handoff')

    def test_pivotal_phase_order_is_checked(self):
        self.expect_invalid(lambda p: p['keyframes'][2].update(time_sec=3.75), 'increase')

    def test_segments_keep_whole_shots(self):
        self.expect_invalid(lambda p: p['segments'][1]['shot_ids'].reverse())

    def test_world_and_execution_continuity_checked_independently(self):
        for nested in (False, True):
            with self.subTest(execution=nested):
                def change(p):
                    row = p['shots'][1]['execution'] if nested else p['shots'][1]
                    row['opening_state'] += '不同'
                self.expect_invalid(change, 'continuous')

    def test_no_copyable_timecode_or_internal_id(self):
        for value in ('在2秒接触。', '在01:02接触。', 'sy_prop 放下。'):
            with self.subTest(value=value):
                self.expect_invalid(lambda p: p['shots'][1]['execution']['cues'][0].update(text=value), 'copyable text')

    def test_reference_fields_preserved_but_not_observed(self):
        self.project['assets'][0]['reference'] = {'source': 'SYNTHETIC 未读取路径', 'control': '外观', 'keep': '文字确认青衣', 'exclude': '不锁定持物手'}
        self.write_source()
        packet = self.packet()
        self.assertEqual(packet['asset_catalog']['characters'][0]['reference'], self.project['assets'][0]['reference'])
        self.assertEqual(packet['semantic_review'], 'NOT_RUN')
        self.node()

    def test_master_only_selected_execution_fields(self):
        packet = self.packet()
        self.assertEqual(packet['master'], fight.execution_master(packet['selection']))
        self.assertNotIn(self.project['beats'][1]['action'], packet['master']['text'])
        self.assertNotIn(self.project['shots'][3]['execution']['cues'][0]['text'], packet['master']['text'])
        self.assertEqual(fight.sha256(packet['master']['text'].encode('utf-8')), packet['master']['text_sha256'])

    def test_requires_collected_recursively(self):
        self.project = legacy(self.project)
        self.project['beats'][2]['requires'] = ['sy_cross']
        self.write_source()
        packet = self.packet('sy_unit_c')
        self.assertEqual({row['id'] for row in packet['selection']['beats']}, {'sy_breath', 'sy_cross', 'sy_future'})
        self.node()

    def test_cost_attrition_and_knowledge_are_raw_records(self):
        packet = self.packet()
        self.assertEqual(packet['selection']['cost'], self.project['cost'])
        self.assertEqual(packet['selection']['attrition'], self.project['scene']['attrition'])
        self.assertEqual(packet['selection']['knowledge'], self.project['knowledge'])
        self.assertEqual(packet['asset_catalog']['actors'][0]['states'], ['右袖破损'])

    def test_omitted_skill_provenance_is_unknown(self):
        provenance = self.packet()['upstream_provenance']
        self.assertEqual(provenance['skill_version'], 'UNKNOWN')
        self.assertEqual(provenance['git_commit'], 'UNKNOWN')
        self.assertEqual(provenance['documents'], [])

    def test_copied_package_cannot_inherit_unrelated_repo_commit(self):
        skill = self.work / 'package'
        skill.mkdir()
        (skill / 'SKILL.md').write_text('---\nname: xianxia-fight-director\n---\nSYNTHETIC\n', encoding='utf-8')
        (skill / 'README.md').write_text('# SYNTHETIC v1.3\n', encoding='utf-8')
        provenance = self.packet(upstream_skill_dir=skill)['upstream_provenance']
        self.assertEqual(provenance['skill_version'], '1.3')
        self.assertEqual(provenance['git_commit'], 'UNKNOWN')
        self.assertEqual(len(provenance['documents']), 2)
        self.node()

    def test_wrong_skill_package_rejected(self):
        skill = self.work / 'wrong'
        skill.mkdir()
        (skill / 'SKILL.md').write_text('name: other-skill\n', encoding='utf-8')
        with self.assertRaises(fight.FightContractError):
            self.packet(upstream_skill_dir=skill)


class LiveSourceChecks(FightFixture):
    def test_unrelated_future_shot_cue_asset_and_frame_changes_preserved(self):
        self.packet()
        self.project['shots'][3]['camera'] += '无关后段机位'
        self.project['shots'][3]['execution']['cues'][0]['text'] += '无关后段动作'
        self.project['assets'][-1]['name'] += '修改'
        self.project['keyframes'][-1]['prompt'] += '无关后段画面'
        self.write_source()
        result = self.node()
        self.assertTrue(any(row['code'] == 'SOURCE_BYTES_CHANGED_OUTSIDE_SELECTION' for row in result['diagnostics']))

    def test_review_only_edits_keep_current_with_explicit_diagnostic(self):
        self.packet()
        self.project['review']['pending'].append('SYNTHETIC 后续审阅附注。')
        self.write_source()
        result = self.node()
        self.assertEqual(result['transitions']['status'], 'CURRENT')
        self.assertTrue(any(row['code'] == 'UPSTREAM_REVIEW_CHANGED' for row in result['diagnostics']))

    def test_full_source_hash_is_evidence_not_global_expiry(self):
        packet = self.packet()
        original_sha = packet['sources'][0]['sha256']
        self.source.write_text(json.dumps(self.project, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        self.assertNotEqual(fight.sha256(self.source.read_bytes()), original_sha)
        result = self.node()
        self.assertEqual(result['lineage']['source_revision'], 'sha256:' + original_sha)

    def test_utf8_bom_crlf_and_decimal_spelling_are_stable(self):
        packet = self.packet()
        self.project['shots'][1]['start'] = 2.0
        self.project['shots'][1]['execution']['cues'][0]['start'] = 2.0
        raw = json_bytes(self.project).replace(b'\n', b'\r\n')
        self.source.write_bytes(b'\xef\xbb\xbf' + raw)
        result = self.node()
        self.assertEqual(result['selected_sha256'], packet['source_selection']['selected_sha256'])

    def test_new_unrelated_record_does_not_change_index_identity(self):
        self.packet()
        self.project['assets'].insert(0, {'id': 'sy_new_unrelated', 'kind': 'prop', 'name': '未来竹筐', 'anchors': ['竹筐'], 'states': [], 'image_prompt': 'SYNTHETIC 竹筐。'})
        self.write_source()
        self.node()

    def test_packet_hash_and_lineage_binding_rejected_when_wrong(self):
        self.packet()
        self.node(False, binding={'intake_sha256': '0' * 64})
        self.node(False, binding={'provider': 'script-to-storyboard-prompts'})
        self.node(False, binding={'lineage': {'unit_id': 'FAKE_FORMAL'}})

    def test_budget_and_shot_map_cannot_be_changed(self):
        packet = self.packet()
        self.node(False, scene={'duration': 12})
        bad = [{'id': row['id'], 'start': row['start_s'], 'end': row['end_s']} for row in packet['budget']['shots']]
        bad[0]['start'] = 2
        self.node(False, scene={'shots': bad})

    def test_optional_adaptation_map_is_checked_when_present(self):
        packet = self.packet()
        mapping = [{'source_shot_id': row['id'], 'scene_shot_id': row['id'], 'source_ref': 'SYNTHETIC selected source', 'status': 'MAPPED'} for row in packet['budget']['shots']]
        self.node(scene={'adaptationMap': mapping})
        mapping[1]['source_shot_id'] = mapping[0]['source_shot_id']
        self.node(False, scene={'adaptationMap': mapping})

    def test_fight_clock_is_optional_and_cannot_shift_origin(self):
        self.packet()
        self.node(False, scene={'fightClock': {'battle_start_s': 0, 'battle_end_s': 4, 'unit_id': 'sy_unit_b'}})
        self.node(False, scene={'fightClock': {'battle_start_s': 2, 'battle_end_s': 6, 'unit_id': 'FORMAL_2'}})
        self.node(False, scene={'fightClock': {'battle_start_s': 2, 'battle_end_s': 6, 'unit_id': 'sy_unit_b', 'world_seconds': 4}})

    def test_actor_creature_manifestation_without_upstream_height_or_look(self):
        packet = self.packet()
        self.assertEqual({row['kind'] for row in packet['asset_catalog']['actors']}, {'character', 'creature', 'manifestation'})
        self.node()
        self.node(False, scene={'actors': [{'id': 'proxy_0', 'height': -1}, {'id': 'proxy_1', 'height': 1.8}, {'id': 'proxy_2', 'height': 2}]})

    def test_wrong_asset_identity_and_duplicate_body_are_rejected(self):
        self.packet()
        bindings = [{'actorId': 'proxy_0', 'assetId': 'sy_prop'}, {'actorId': 'proxy_1', 'assetId': 'sy_actor_b'}, {'actorId': 'proxy_2', 'assetId': 'sy_actor_c'}]
        self.node(False, scene={'assetBindings': bindings})
        bindings[0]['assetId'] = 'sy_actor_b'
        self.node(False, scene={'assetBindings': bindings})

    def test_sealed_derived_fields_cannot_be_tampered_with(self):
        for key in ('budget', 'master', 'selection', 'asset_catalog'):
            with self.subTest(key=key):
                packet = self.packet()
                packet[key] = {}
                self.packet_file.write_bytes(json_bytes(packet))
                self.node(False)

    def test_structural_pass_cannot_be_relabelled_semantic_pass(self):
        packet = self.packet()
        packet['semantic_status'] = 'pass'
        self.packet_file.write_bytes(json_bytes(packet))
        self.node(False)

    def test_read_only_repeated_validation(self):
        packet = self.packet()
        source_before, packet_before = self.source.read_bytes(), self.packet_file.read_bytes()
        for _ in range(3):
            result = self.node()
            self.assertEqual(result['selected_sha256'], packet['source_selection']['selected_sha256'])
        self.assertEqual(self.source.read_bytes(), source_before)
        self.assertEqual(self.packet_file.read_bytes(), packet_before)


class HumanTranscription(FightFixture):
    def test_manual_cli_with_all_six_files_and_unknown_assumptions(self):
        draft, specs = self.manual()
        args = ['--draft', self.source, '--out', self.packet_file]
        for spec in specs:
            args.extend(['--evidence', spec])
        before = {file.name: file.read_bytes() for file in self.work.iterdir() if file.is_file()}
        result = self.cli(*args)
        self.assertEqual(result['input_mode'], 'FIGHT_TRANSCRIPTION')
        self.assertEqual(result['structural_status'], 'NOT_CLAIMED')
        packet = fight.read_json(self.packet_file)
        self.assertEqual(packet['draft_snapshot'], draft)
        self.assertEqual(len(packet['evidence_snapshot']), 6)
        for record in packet['evidence_snapshot']:
            self.assertEqual(base64.b64decode(record['bytes_base64']), before[record['role'] + '.md'])
        self.node()
        for name, content in before.items():
            self.assertEqual((self.work / name).read_bytes(), content)

    def test_manual_does_not_require_upstream_json_pass(self):
        _, packet, _ = self.manual_packet()
        self.assertEqual(packet['structural_status'], 'NOT_CLAIMED')
        self.assertEqual(packet['mapped_structural_status'], 'pass')
        self.assertEqual(packet['transcription']['source_claim'], 'HUMAN_TRANSCRIPTION_ONLY')
        self.node()

    def test_manual_missing_evidence_rejected(self):
        _, specs = self.manual()
        with self.assertRaises(fight.FightContractError):
            fight.create_packet(self.source, None, self.packet_file, draft_mode=True, evidence=specs[:-1])

    def test_empty_or_whitespace_original_evidence_is_rejected(self):
        for raw in (b'', b'  \r\n\t', b'\xef\xbb\xbf  \n'):
            with self.subTest(raw=raw):
                _, specs = self.manual()
                (self.work / 'design.md').write_bytes(raw)
                with self.assertRaisesRegex(fight.FightContractError, 'Empty original evidence'):
                    fight.create_packet(self.source, None, self.packet_file, draft_mode=True, evidence=specs)

    def fragment_manual(self):
        _, specs = self.manual()
        file = self.work / 'storyboard.md'
        file.write_text('# Selected\nOriginal selected source window.\n\n# Other\nUnrelated later unit.\n', encoding='utf-8')
        specs = ['storyboard=storyboard.md#selected' if spec.startswith('storyboard=') else spec for spec in specs]
        packet = fight.create_packet(self.source, None, self.packet_file, draft_mode=True, evidence=specs)
        self.packet_file.parent.mkdir(parents=True, exist_ok=True)
        self.packet_file.write_bytes(json_bytes(packet))
        return file, packet

    def test_manual_explicit_fragment_ignores_unrelated_original_section(self):
        file, packet = self.fragment_manual()
        self.node()
        file.write_text('# Selected\nOriginal selected source window.\n\n# Other\nLater-only change.\n', encoding='utf-8')
        self.node()

    def test_manual_fragment_bom_crlf_matches_node_and_ignores_line_endings(self):
        _, specs = self.manual()
        file = self.work / 'storyboard.md'
        file.write_bytes(b'\xef\xbb\xbf# Selected\r\nOriginal selected source window.\r\n\r\n# Other\r\nLater text.\r\n')
        specs = ['storyboard=storyboard.md#selected' if spec.startswith('storyboard=') else spec for spec in specs]
        packet = fight.create_packet(self.source, None, self.packet_file, draft_mode=True, evidence=specs)
        self.packet_file.parent.mkdir(parents=True, exist_ok=True)
        self.packet_file.write_bytes(json_bytes(packet))
        self.node()
        file.write_bytes(b'# Selected\nOriginal selected source window.\n\n# Other\nLater-only revision.\n')
        self.node()

    def test_manual_selected_original_fragment_change_is_rejected(self):
        file, packet = self.fragment_manual()
        self.node()
        file.write_text('# Selected\nChanged selected attack.\n\n# Other\nUnrelated later unit.\n', encoding='utf-8')
        self.node(False)

    def test_manual_duplicate_evidence_rejected(self):
        _, specs = self.manual()
        with self.assertRaises(fight.FightContractError):
            fight.create_packet(self.source, None, self.packet_file, draft_mode=True, evidence=specs + [specs[0]])

    def test_manual_explicit_locator_required_for_all_roles(self):
        draft, _ = self.manual()
        draft['mapping'].pop()
        with self.assertRaises(fight.FightContractError):
            fight.validate_draft(draft)

    def test_manual_bad_json_pointer_is_not_guessed(self):
        draft, _ = self.manual()
        draft['mapping'][0]['target'] = '/project/unknown/0'
        with self.assertRaises(fight.FightContractError):
            fight.validate_draft(draft)

    def test_manual_array_pointer_is_canonical(self):
        for suffix in ('-1', '01', '+1', 'length'):
            with self.subTest(index=suffix):
                draft, _ = self.manual()
                draft['mapping'][0]['target'] = '/project/shots/' + suffix
                with self.assertRaises(fight.FightContractError):
                    fight.validate_draft(draft)

    def test_manual_segment_cli_mismatch_rejected(self):
        _, specs = self.manual()
        with self.assertRaises(fight.FightContractError):
            fight.create_packet(self.source, 'sy_unit_a', self.packet_file, draft_mode=True, evidence=specs)

    def test_manual_original_execution_bytes_change_rejected(self):
        self.manual_packet()
        (self.work / 'execution.md').write_text('SYNTHETIC changed actual execution source', encoding='utf-8')
        self.node(False)

    def test_manual_original_review_note_change_is_diagnostic_only(self):
        self.manual_packet()
        (self.work / 'review.md').write_text('SYNTHETIC new review note', encoding='utf-8')
        result = self.node()
        self.assertTrue(any(row['code'] == 'UPSTREAM_REVIEW_EVIDENCE_CHANGED' for row in result['diagnostics']))

    def test_manual_mapping_change_rejected_without_parsing_free_text(self):
        draft, _, _ = self.manual_packet()
        draft['mapping'][0]['locator'] = 'SYNTHETIC different human section'
        self.source.write_bytes(json_bytes(draft))
        self.node(False)

    def test_manual_unrelated_project_shot_can_advance(self):
        draft, _, _ = self.manual_packet()
        draft['project']['shots'][3]['camera'] += 'SYNTHETIC future camera'
        self.source.write_bytes(json_bytes(draft))
        self.node()

    def test_manual_sealed_original_segment_mismatch_rejected(self):
        _, packet, _ = self.manual_packet()
        packet['draft_snapshot']['segment_id'] = 'sy_unit_a'
        self.packet_file.write_bytes(json_bytes(packet))
        self.node(False)

    def test_manual_sealed_bytes_hash_mismatch_rejected(self):
        _, packet, _ = self.manual_packet()
        packet['evidence_snapshot'][0]['bytes_base64'] = base64.b64encode(b'forged').decode('ascii')
        self.packet_file.write_bytes(json_bytes(packet))
        self.node(False)


# Each negative sample is an independent unittest case. Unknown field names are
# original synthetic probes, not permissively ignored forward-version support.
UNKNOWN_TARGETS = {
    'root': lambda p: p,
    'design': lambda p: p['design'],
    'scene': lambda p: p['scene'],
    'asset': lambda p: p['assets'][0],
    'beat': lambda p: p['beats'][0],
    'shot': lambda p: p['shots'][0],
    'execution': lambda p: p['shots'][0]['execution'],
    'cue': lambda p: p['shots'][0]['execution']['cues'][0],
    'segment': lambda p: p['segments'][0],
    'keyframe': lambda p: p['keyframes'][0],
    'cost': lambda p: p['cost'][0],
    'attrition': lambda p: p['scene']['attrition'][0],
    'knowledge': lambda p: p['knowledge'][0],
    'review': lambda p: p['review'],
}
for name, target in UNKNOWN_TARGETS.items():
    def test_unknown(self, target=target):
        self.expect_invalid(lambda p: target(p).update(SYNTHETIC_unknown='reject'), 'unknown fields')
        self.packet()
        target(self.project)['SYNTHETIC_unknown'] = 'reject'
        self.write_source()
        self.node(False)
    setattr(ContractValidation, 'test_unknown_field_' + name + '_python_and_node', test_unknown)

LEGACY_MIXINS = {
    'cost': lambda p: p.update(cost=[]),
    'knowledge': lambda p: p.update(knowledge=[]),
    'marks': lambda p: p['beats'][0].update(marks=['breath']),
    'light': lambda p: p['shots'][0].update(light='light'),
    'risk': lambda p: p['shots'][0].update(risk='low'),
    'fallback': lambda p: p['shots'][0].update(fallback='fallback'),
    'execution_light': lambda p: p['shots'][0]['execution'].update(light='light'),
    'role': lambda p: p['keyframes'][0].update(role='single'),
    'attrition': lambda p: p['scene'].update(attrition=[]),
}
for name, mutate in LEGACY_MIXINS.items():
    def test_legacy_mixin(self, mutate=mutate):
        self.project = legacy(self.project)
        self.write_source()
        self.packet()
        mutate(self.project)
        with self.assertRaises(fight.FightContractError):
            fight.validate_project(self.project)
        self.write_source()
        self.node(False)
    setattr(ContractValidation, 'test_legacy11_rejects12_' + name, test_legacy_mixin)

SOURCE_MUTATIONS = {
    'shot_camera': lambda p: p['shots'][1].update(camera='SYNTHETIC selected camera changed'),
    'cue_text': lambda p: p['shots'][1]['execution']['cues'][0].update(text='SYNTHETIC selected cue changed'),
    'full_related_beat': lambda p: p['beats'][1].update(response='SYNTHETIC response changed'),
    'recursive_prerequisite': lambda p: p['beats'][0].update(result='SYNTHETIC prerequisite changed'),
    'actor_anchor': lambda p: p['assets'][0]['anchors'].append('SYNTHETIC new anchor'),
    'prop_state': lambda p: p['assets'][4]['states'].append('SYNTHETIC changed identity state'),
    'keyframe': lambda p: p['keyframes'][2].update(prompt='SYNTHETIC selected prep changed'),
    'inbound_handoff': lambda p: p['keyframes'][1].update(state='SYNTHETIC inbound state changed'),
    'outbound_handoff': lambda p: p['keyframes'][5].update(prompt='SYNTHETIC outbound prompt changed'),
    'cost': lambda p: p['cost'][0].update(consequence='SYNTHETIC resource effect changed'),
    'attrition': lambda p: p['scene']['attrition'][0].update(mark='SYNTHETIC terrain changed'),
    'knowledge': lambda p: p['knowledge'][0].update(truth='SYNTHETIC actual truth changed'),
    'world_rules': lambda p: p['design']['rules'].append('SYNTHETIC rule changed'),
    'geography': lambda p: p['scene'].update(geography='SYNTHETIC scene changed'),
}
for name, mutate in SOURCE_MUTATIONS.items():
    def test_mutation(self, mutate=mutate):
        self.packet()
        mutate(self.project)
        fight.validate_project(self.project)
        self.write_source()
        self.assertEqual(self.node(False)['code'], 'FIGHT_SOURCE_CHANGED')
    setattr(LiveSourceChecks, 'test_selected_change_' + name, test_mutation)


class LocalPublicArchives(FightFixture):
    @unittest.skipUnless(ARCHIVE.is_dir(), 'optional local upstream example archive not supplied')
    def test_four_public_examples_all_original_segments_actual_cli_node_no_writes(self):
        files = sorted(ARCHIVE.glob('*.json'))
        self.assertEqual(len(files), 4)
        archive_files = [file for file in ARCHIVE.parent.rglob('*') if file.is_file()]
        before = {file: hashlib.sha256(file.read_bytes()).hexdigest() for file in archive_files}
        commands = 0
        for file in files:
            project = fight.read_json(file)
            fight.validate_project(project)
            for segment in project['segments']:
                with self.subTest(example=file.name, segment=segment['id']):
                    self.packet_file = self.work / file.stem / segment['id'] / 'upstream-intake.json'
                    self.cli('--project', file, '--segment', segment['id'], '--out', self.packet_file, '--upstream-skill-dir', ARCHIVE.parent)
                    packet = fight.read_json(self.packet_file)
                    self.assertEqual(packet['source_snapshot'], project)
                    self.assertEqual(packet['upstream_provenance']['skill_version'], '1.3')
                    self.assertEqual(packet['upstream_provenance']['git_commit'], '26f26971e52b1ecb8300cc867f32bafa9f1f06c9')
                    self.node()
                    commands += 2
        after = {file: hashlib.sha256(file.read_bytes()).hexdigest() for file in archive_files}
        self.assertEqual(before, after)
        self.assertEqual(commands, 24)


if __name__ == '__main__':
    unittest.main()
