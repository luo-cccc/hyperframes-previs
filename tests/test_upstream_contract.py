"""Executable contract regressions; no third-party Python/Node dependencies.

Run: python -B -X utf8 -m unittest discover -s tests -p test_upstream_contract.py -v
Set UPSTREAM_CONTRACT_EVIDENCE_DIR to retain per-command inputs, outputs and hashes.
All invented DONE/PASS fixtures are explicitly synthetic; media is never claimed.
"""
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

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'scripts'))
from intake_storyboard import prepare, state_scope, local_ref
from finalize_manual_intake import finalize
from upstream_contract import (collect_transition_context, resolve_script_reference,
                               transition_context_sha256, upstream_provenance)

FIXTURES = REPO / 'tests/fixtures/upstream-contract'
CHECKER = (REPO / 'assets/starter/scripts/check-upstream.mjs').as_uri()
TRANSITIONS = (REPO / 'assets/starter/scripts/transition-context.mjs').as_uri()
NODE_RUNNER = """
import {readFileSync} from 'node:fs';
const input=JSON.parse(readFileSync(0,'utf8'));
try {
  const module=await import(input.module);let result;
  if(input.mode==='check')result=await module.checkUpstream(input.root,input.scene);
  if(input.mode==='core')result=module.currentStateScope(input.state,input.formal_id,input.profile);
  if(input.mode==='snapshot')result=module.snapshotV3(input.state,input.formal_id);
  if(input.mode==='context')result=module.collectTransitionContext(input.state,input.formal_id,input.prompt_version);
  if(input.mode==='alias')result=await module.resolveSourceScriptRef(input.script,input.base);
  console.log(JSON.stringify({ok:true,result}));
} catch(error){console.log(JSON.stringify({ok:false,error:error.message}));process.exitCode=1}
"""


def load(file):
    return json.loads(Path(file).read_text(encoding='utf-8-sig'))


def dump(file, value):
    Path(file).parent.mkdir(parents=True, exist_ok=True)
    Path(file).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8', newline='\n')


def digest(content):
    return hashlib.sha256(content).hexdigest()


def tree_hashes(directory):
    return {file.relative_to(directory).as_posix(): digest(file.read_bytes()) for file in directory.rglob('*') if file.is_file()}


class UpstreamContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='previs-contract-')
        self.root = Path(self.temp.name)
        self.upstream = self.root / 'upstream'
        shutil.copytree(FIXTURES, self.upstream)
        self.state_file = self.upstream / 'state.json'
        self.state = load(self.state_file)
        self.project = self.root / 'project'
        self.project.mkdir()
        self.intake = self.project / 'upstream-intake.json'
        self.commands = []
        self.evidence = os.environ.get('UPSTREAM_CONTRACT_EVIDENCE_DIR')

    def tearDown(self):
        if self.evidence:
            directory = Path(self.evidence) / self._testMethodName
            dump(directory / 'commands.json', self.commands)
            # A compact reproducible snapshot; never modify the checked-in fixture.
            shutil.copytree(self.upstream, directory / 'upstream', dirs_exist_ok=True)
            shutil.copytree(self.project, directory / 'project', dirs_exist_ok=True)
        self.temp.cleanup()

    def save_state(self):
        dump(self.state_file, self.state)

    def packet(self, skill_dir=None):
        self.save_state()
        before = tree_hashes(self.upstream)
        packet = prepare(self.state_file, self.upstream / 'budget.json', 'FORMAL_1', self.intake,
                         upstream_skill_dir=skill_dir)
        self.assertEqual(before, tree_hashes(self.upstream), 'Python intake wrote upstream inputs')
        return packet

    def seal(self, packet=None):
        packet = self.packet() if packet is None else packet
        dump(self.intake, packet)
        self.scene = {'width': 640, 'height': 360, 'duration': packet['budget']['duration_s'],
                      'shots': [{'id': row['id'], 'start': row['start_s'], 'end': row['end_s']} for row in packet['budget']['shots']],
                      'adaptationMap': [{'source_shot_id': row['id'], 'scene_shot_id': row['id'], 'source_ref': 'SYNTHETIC: '+packet['master']['ref'], 'status': 'MAPPED'} for row in packet['budget']['shots']],
                      'actors': [], 'assetBindings': [], 'sourceAssetIds': {'characters': [], 'scenes': [], 'props': []},
                      'upstream': {'intake': 'upstream-intake.json', 'intake_sha256': digest(self.intake.read_bytes()),
                                   **{key: packet[key] for key in ('project_id', 'formal_id', 'prompt_version', 'budget_version')}}}
        return packet

    def command(self, arguments, *, payload=None, ok=True):
        before = tree_hashes(self.upstream)
        completed = subprocess.run([str(item) for item in arguments], input=json.dumps(payload, ensure_ascii=False) if payload is not None else None,
                                   cwd=REPO, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=30,
                                   env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONIOENCODING': 'utf-8'})
        after = tree_hashes(self.upstream)
        self.commands.append({'arguments': [str(item) for item in arguments], 'input': payload, 'exit_code': completed.returncode,
                              'stdout': completed.stdout, 'stderr': completed.stderr, 'sources_before': before, 'sources_after': after})
        self.assertEqual(before, after, 'CLI wrote upstream inputs')
        self.assertEqual(completed.returncode == 0, ok, completed.stdout+'\n'+completed.stderr)
        return completed

    def node(self, mode, *, ok=True, **data):
        module = TRANSITIONS if mode in ('context', 'alias') else CHECKER
        result = self.command(['node', '--input-type=module', '-e', NODE_RUNNER],
                              payload={'module': module, 'mode': mode, **data}, ok=ok)
        return json.loads(result.stdout)

    def check(self, ok=True):
        return self.node('check', root=str(self.project), scene=self.scene, ok=ok)

    def assert_rejected(self, mutate, message):
        self.seal()
        mutate(self.state)
        self.save_state()
        self.assertIn(message, self.check(ok=False)['error'])

    def test_path_alias_preserved(self):
        packet = self.seal()
        self.assertEqual(packet['adapter_version'], '0.6.1')
        self.assertEqual(packet['schema_version'], 'STORYBOARD_PREVIS_ADAPTER_V1')
        self.assertEqual(packet['upstream_snapshot']['source_script_ref'], self.state['source_script_ref'])
        self.assertEqual(packet['resolved_source_script_ref']['aliases'], {'path': 'script.md#source'})
        self.assertEqual(self.check()['result']['transitions']['status'], 'CURRENT')

    def test_location_alias_preserved(self):
        self.state['source_script_ref']['location'] = self.state['source_script_ref'].pop('path')
        packet = self.seal()
        self.assertNotIn('path', packet['upstream_snapshot']['source_script_ref'])
        self.assertTrue(self.check()['ok'])

    def test_equivalent_aliases(self):
        self.state['source_script_ref']['location'] = './script.md#source'
        packet = self.seal()
        resolved = self.node('alias', script=self.state['source_script_ref'], base=str(self.upstream))['result']
        self.assertEqual(resolved, packet['resolved_source_script_ref'])
        self.assertTrue(self.check()['ok'])

    def test_alias_case_on_windows(self):
        if os.name != 'nt':
            self.skipTest('Case-insensitive filesystem contract applies to Windows')
        self.state['source_script_ref']['location'] = 'SCRIPT.MD#source'
        self.seal()
        self.assertTrue(self.check()['ok'])

    def test_alias_file_conflict(self):
        self.state['source_script_ref']['location'] = 'checks.md#formal-1'
        with self.assertRaisesRegex(ValueError, 'path and source_script_ref.location conflict'):
            self.packet()
        self.assertIn('conflict', self.node('alias', script=self.state['source_script_ref'], base=str(self.upstream), ok=False)['error'])

    def test_alias_fragment_conflict(self):
        self.state['source_script_ref']['location'] = 'script.md#other'
        with self.assertRaisesRegex(ValueError, 'different files or Markdown fragments'):
            self.packet()
        self.assertIn('conflict', self.node('alias', script=self.state['source_script_ref'], base=str(self.upstream), ok=False)['error'])

    def test_missing_aliases(self):
        self.state['source_script_ref'].pop('path')
        with self.assertRaisesRegex(ValueError, 'neither field is present'):
            self.packet()
        self.assertIn('neither field is present', self.node('alias', script=self.state['source_script_ref'], base=str(self.upstream), ok=False)['error'])

    def test_empty_alias_has_specific_error(self):
        self.state['source_script_ref']['location'] = ''
        with self.assertRaisesRegex(ValueError, 'source_script_ref.location must be a nonempty'):
            self.packet()
        self.assertIn('source_script_ref.location', self.node('alias', script=self.state['source_script_ref'], base=str(self.upstream), ok=False)['error'])

    def test_missing_file_names_alias(self):
        self.state['source_script_ref']['path'] = 'missing.md'
        with self.assertRaisesRegex(ValueError, 'source_script_ref.path: Referenced file is missing'):
            self.packet()
        self.assertIn('source_script_ref.path:', self.node('alias', script=self.state['source_script_ref'], base=str(self.upstream), ok=False)['error'])

    def test_live_alias_conflict_is_specific(self):
        self.assert_rejected(lambda state: state['source_script_ref'].update(location='script.md#other'), 'conflict')

    def test_python_node_core_profiles_equal(self):
        for profile in ('SCOPED_STATE_V2', 'SCOPED_STATE_V3'):
            with self.subTest(profile=profile):
                python = state_scope(self.state, 'FORMAL_1', profile)
                node = self.node('core', state=self.state, formal_id='FORMAL_1', profile=profile)['result']
                self.assertEqual(python, node)
                self.assertEqual('scope' in python['coverage']['TEXT'], profile.endswith('V3'))

    def test_snapshot_keeps_transitions_out_of_core(self):
        before = self.node('snapshot', state=self.state, formal_id='FORMAL_1')['result']
        self.state['transition_plan'][1]['screen_motion'] = 'SYNTHETIC: altered motion'
        after = self.node('snapshot', state=self.state, formal_id='FORMAL_1')['result']
        self.assertEqual(before['core'], after['core'])
        self.assertNotEqual(before['transition_context']['sha256'], after['transition_context']['sha256'])

    def test_v3_text_scope_change_rejected(self):
        self.assert_rejected(lambda state: state['coverage_ledger'][0]['checks']['TEXT'].update(scope='SYNTHETIC: narrower scope'), 'evidence changed')

    def test_v2_text_scope_legacy_semantics(self):
        packet = self.packet()
        packet.update(validation_profile='SCOPED_STATE_V2', adapter_version='0.4.0', state_scope=state_scope(self.state, 'FORMAL_1', 'SCOPED_STATE_V2'))
        packet.pop('transition_context')
        self.seal(packet)
        self.state['coverage_ledger'][0]['checks']['TEXT']['scope'] = 'SYNTHETIC: narrower scope'
        self.state['transition_plan'][1]['screen_motion'] = 'Legacy intake did not track transitions.'
        self.save_state()
        result = self.check()['result']
        self.assertEqual(result['transitions']['status'], 'NOT_DECLARED')
        self.assertEqual(result['packet']['adapter_version'], '0.4.0')

    def test_missing_scope_is_diagnostic_not_invented(self):
        del self.state['coverage_ledger'][0]['checks']['TEXT']['scope']
        packet = self.seal()
        self.assertNotIn('scope', packet['state_scope']['coverage']['TEXT'])
        self.assertTrue(any(row['code'] == 'TEXT_SCOPE_NOT_DECLARED' for row in packet['diagnostics']))
        self.assertEqual(packet['semantic_review'], 'NOT_RUN')
        self.assertTrue(self.check()['ok'])
        self.state['coverage_ledger'][0]['checks']['TEXT']['scope'] = 'New explicitly supplied scope'
        self.save_state()
        self.assertFalse(self.check(ok=False)['ok'])

    def test_text_status_cannot_be_promoted(self):
        self.assert_rejected(lambda state: state['coverage_ledger'][0]['checks']['TEXT'].update(status='FAIL'), 'TEXT evidence is no longer valid')

    def test_text_evidence_change_rejected(self):
        self.assert_rejected(lambda state: state['coverage_ledger'][0]['checks']['TEXT'].update(evidence='checks.md#other'), 'evidence changed')

    def test_related_plan_change_only_stales_transitions(self):
        packet = self.seal()
        self.state['transition_plan'][1]['screen_motion'] = 'SYNTHETIC: changed neighboring motion'
        self.save_state()
        result = self.check()['result']
        self.assertEqual(result['transitions']['status'], 'STALE')
        self.assertEqual(result['transitions']['expected_sha256'], packet['transition_context']['sha256'])
        self.assertNotEqual(result['transitions']['expected_sha256'], result['transitions']['current_sha256'])
        self.assertEqual(result['packet']['master'], packet['master'])

    def test_related_review_change_only_stales_transitions(self):
        self.seal()
        self.state['transition_review'][-1]['status'] = 'PENDING'
        self.save_state()
        self.assertEqual(self.check()['result']['transitions']['status'], 'STALE')

    def test_unsupported_transition_shape_stales_without_core_failure(self):
        self.seal()
        self.state['transition_plan'] = {'unrecognized': 'shape'}
        self.save_state()
        result = self.check()['result']['transitions']
        self.assertEqual(result['status'], 'STALE')
        self.assertTrue(any(row['code'] == 'UNSUPPORTED_TRANSITION_COLLECTION' for row in result['context']['diagnostics']))

    def test_null_transition_collection_python_node_parity(self):
        self.state['transition_plan'] = None
        python = collect_transition_context(self.state, 'FORMAL_1', 'P2')
        node = self.node('context', state=self.state, formal_id='FORMAL_1', prompt_version='P2')['result']
        self.assertEqual(python, node)

    def test_unsupported_plan_registry_cannot_throw_core_error(self):
        self.seal()
        self.state['segment_plan'] = None
        self.save_state()
        result = self.check()['result']['transitions']
        self.assertEqual(result['status'], 'CURRENT')
        self.assertTrue(any(row['code'] == 'UNSUPPORTED_SEGMENT_PLAN_COLLECTION' for row in result['context']['diagnostics']))
        python = collect_transition_context(self.state, 'FORMAL_1', 'P2')
        node = self.node('context', state=self.state, formal_id='FORMAL_1', prompt_version='P2')['result']
        self.assertEqual(python, node)

    def test_related_unknown_fields_are_hashed_and_preserved(self):
        packet = self.seal()
        self.assertEqual(packet['transition_context']['plans'][0]['unknown_extension'], self.state['transition_plan'][1]['unknown_extension'])
        self.state['transition_plan'][1]['unknown_extension']['new_field'] = {'arbitrary': True}
        self.save_state()
        self.assertEqual(self.check()['result']['transitions']['status'], 'STALE')

    def test_unrelated_insertions_do_not_change_hash(self):
        packet = self.seal()
        for key in ('transition_plan', 'transition_review'):
            self.state[key].insert(0, {'id': 'UNRELATED', 'from': 'FORMAL_9', 'to': 'FORMAL_10', 'from_prompt_version': 'P4', 'to_prompt_version': 'P8', 'unknown': 'Changed unrelated content'})
        self.state['state_seq'] = 999
        self.state['next_required'] = 'UNRELATED_PROGRESS'
        self.save_state()
        result = self.check()['result']['transitions']
        self.assertEqual(result['status'], 'CURRENT')
        self.assertEqual(result['current_sha256'], packet['transition_context']['sha256'])
        self.assertNotEqual(result['context']['source_locations'], packet['transition_context']['source_locations'])

    def test_historical_versions_are_not_selected(self):
        packet = self.seal()
        self.assertEqual([row['id'] for row in packet['transition_context']['plans']], ['ACTIVE'])
        self.assertEqual(len(packet['transition_context']['reviews']), 2)
        self.state['transition_plan'][0]['unknown_extension'] = 'Historical change'
        self.state['transition_review'][0]['status'] = 'FAIL'
        self.save_state()
        self.assertEqual(self.check()['result']['transitions']['status'], 'CURRENT')

    def test_invalid_matching_history_does_not_enter_dependencies(self):
        historical = copy.deepcopy(self.state['transition_plan'][1])
        historical.update(id='INVALID-SAME-PROMPTS', status='INVALID')
        self.state['transition_plan'].append(historical)
        packet = self.seal()
        self.assertEqual([row['id'] for row in packet['transition_context']['plans']], ['ACTIVE'])
        self.state['transition_plan'][-1]['screen_motion'] = 'Irrelevant invalidated history'
        self.save_state()
        self.assertEqual(self.check()['result']['transitions']['status'], 'CURRENT')

    def test_active_transition_invalidated_stales_evidence(self):
        self.seal()
        self.state['transition_plan'][1]['status'] = 'INVALID'
        self.save_state()
        self.assertEqual(self.check()['result']['transitions']['status'], 'STALE')

    def test_explicit_stale_plan_version_is_not_selected(self):
        self.state['transition_plan'][1]['to_plan_version'] = 'OLD-PLAN'
        packet = self.seal()
        self.assertEqual(packet['transition_context']['plans'], [])
        node = self.node('context', state=self.state, formal_id='FORMAL_1', prompt_version='P2')['result']
        self.assertEqual(node['sha256'], packet['transition_context']['sha256'])
        self.assertTrue(self.check()['ok'])

    def test_neighbor_version_change_stales_only_transitions(self):
        self.seal()
        self.state['coverage_ledger'][1]['prompt_version'] = 'P2'
        self.state['prompt_versions'][-1]['prompt_version'] = 'P2'
        self.save_state()
        self.assertEqual(self.check()['result']['transitions']['status'], 'STALE')

    def test_neighbor_boundary_change_stales_only_transitions(self):
        self.seal()
        self.state['coverage_ledger'][1]['start_state']['door_phase'] = 0.7
        self.save_state()
        self.assertEqual(self.check()['result']['transitions']['status'], 'STALE')

    def test_own_boundary_change_still_rejects_core(self):
        self.assert_rejected(lambda state: state['coverage_ledger'][0]['end_state'].update(door_phase=0.7), 'evidence changed')

    def test_source_fragment_change_still_rejects_core(self):
        self.seal()
        file = self.upstream / 'script.md'
        file.write_text(file.read_text(encoding='utf-8').replace('a door continues opening.', 'a door closes.'), encoding='utf-8')
        self.assertIn('source_script selected fragment', self.check(ok=False)['error'])

    def future_plan(self, unversioned=False):
        self.state['coverage_ledger'] = self.state['coverage_ledger'][:1]
        self.state['prompt_versions'] = self.state['prompt_versions'][:-1]
        record = self.state['transition_plan'][1]
        record.pop('to_prompt_version')
        record.update(to_plan_version='PLAN-1', status='PLANNED', actual_next_formal_delivered=False)
        if unversioned:
            record.pop('from_prompt_version')
            record.pop('to_plan_version')
        self.state['transition_plan'] = [record]
        self.state['transition_review'] = self.state['transition_review'][1:2]

    def test_undelivered_endpoint_stays_planned(self):
        self.future_plan()
        packet = self.seal()
        context = packet['transition_context']
        self.assertEqual(context['plans'], self.state['transition_plan'])
        self.assertEqual(context['plans'][0]['status'], 'PLANNED')
        self.assertFalse(context['plans'][0]['actual_next_formal_delivered'])
        self.assertEqual(context['endpoint_dependencies'][0]['endpoints']['to']['delivery_status'], 'PLANNED')
        self.assertTrue(any(row['code'] == 'TRANSITION_ENDPOINT_NOT_DELIVERED' for row in context['diagnostics']))
        self.assertEqual(self.check()['result']['transitions']['status'], 'CURRENT')

    def test_legacy_unversioned_plan_binds_actual_boundaries(self):
        self.future_plan(unversioned=True)
        packet = self.seal()
        self.assertEqual(len(packet['transition_context']['plans']), 1)
        self.assertNotIn('from_prompt_version', packet['transition_context']['plans'][0])
        self.assertEqual(packet['transition_context']['endpoint_dependencies'][0]['endpoints']['from']['binding_basis'], 'MATCHING_BOUNDARY_STATE')
        self.assertEqual(self.check()['result']['transitions']['status'], 'CURRENT')

    def test_planned_boundary_accepts_only_known_delivery_annotations(self):
        self.future_plan(unversioned=True)
        self.state['coverage_ledger'][0]['end_state'].update(source={'formal_id': 'FORMAL_1', 'prompt_version': 'P2'}, viewing={'not_yet_presented': ['corridor']})
        packet = self.seal()
        self.assertEqual(len(packet['transition_context']['plans']), 1)
        self.assertEqual(self.check()['result']['transitions']['status'], 'CURRENT')
        self.state['coverage_ledger'][0]['end_state']['unknown_physical_fact'] = 'must not be ignored'
        python = collect_transition_context(self.state, 'FORMAL_1', 'P2')
        node = self.node('context', state=self.state, formal_id='FORMAL_1', prompt_version='P2')['result']
        self.assertEqual(python['plans'], [])
        self.assertEqual(python['sha256'], node['sha256'])

    def test_plan_declared_viewing_mismatch_is_not_ignored(self):
        self.future_plan(unversioned=True)
        self.state['transition_plan'][0]['previous_end_state']['viewing'] = {'revealed': False}
        self.state['coverage_ledger'][0]['end_state']['viewing'] = {'revealed': True}
        packet = self.seal()
        self.assertEqual(packet['transition_context']['plans'], [])
        self.assertTrue(self.check()['ok'])

    def test_unversioned_wrong_boundary_is_not_guessed(self):
        self.future_plan(unversioned=True)
        self.state['transition_plan'][0]['previous_end_state'] = {'door_phase': 0.8}
        packet = self.seal()
        self.assertEqual(packet['transition_context']['plans'], [])
        self.assertTrue(any(row['code'] == 'TRANSITION_VERSION_NOT_CURRENT' for row in packet['transition_context']['diagnostics']))
        self.assertTrue(self.check()['ok'])

    def test_no_transition_declared(self):
        self.state['transition_plan'] = []
        self.state['transition_review'] = []
        packet = self.seal()
        result = self.check()['result']['transitions']
        self.assertEqual(result['status'], 'NOT_DECLARED')
        self.assertEqual(result['expected_sha256'], result['current_sha256'])
        self.assertEqual(packet['transition_context']['plans'], [])

    def test_new_transition_after_empty_seal_is_stale(self):
        plans = self.state.pop('transition_plan')
        self.state['transition_review'] = []
        self.seal()
        self.state['transition_plan'] = plans
        self.save_state()
        self.assertEqual(self.check()['result']['transitions']['status'], 'STALE')

    def test_removed_transition_is_stale(self):
        self.seal()
        self.state.pop('transition_plan')
        self.state.pop('transition_review')
        self.save_state()
        self.assertEqual(self.check()['result']['transitions']['status'], 'STALE')

    def test_python_node_transition_hash_numeric_unicode_parity(self):
        self.state['transition_plan'][1]['unknown_extension']['numeric_edges'] = [9.0, 1e-7, 1e21, -0.0, 0.30000000000000004, 9007199254740993]
        python = collect_transition_context(self.state, 'FORMAL_1', 'P2')
        node = self.node('context', state=self.state, formal_id='FORMAL_1', prompt_version='P2')['result']
        self.assertEqual(python['sha256'], node['sha256'])
        self.assertEqual(transition_context_sha256(python), node['sha256'])

    def test_request_blockers_do_not_block_local_previs(self):
        self.state['blocking_items'] = [{'request_id': 'PLATFORM-SUBMISSION', 'owner_formal_id': 'FORMAL_1', 'step_id': 'ADAPT_FORMAL_1', 'blocks': ['*', 'COMPLETE'], 'scope': 'SYNTHETIC: only platform request', 'gap': 'No real A/B media or model capability'}]
        packet = self.seal()
        self.assertTrue(any(row['code'] == 'REQUEST_SCOPED_BLOCKER' and row['blocker'] == self.state['blocking_items'][0] for row in packet['diagnostics']))
        self.assertTrue(self.check()['ok'])
        self.assertEqual(self.node('core', state=self.state, formal_id='FORMAL_1', profile='SCOPED_STATE_V3')['result'], state_scope(self.state, 'FORMAL_1'))
        with self.assertRaisesRegex(ValueError, 'current blocker'):
            state_scope(self.state, 'FORMAL_1', 'SCOPED_STATE_V2')
        self.node('core', state=self.state, formal_id='FORMAL_1', profile='SCOPED_STATE_V2', ok=False)

    def test_request_id_cannot_hide_an_explicit_formal_blocker(self):
        self.assert_rejected(lambda state: state['blocking_items'].append({'request_id': 'REPAIR-REQUEST', 'blocks': ['FORMAL_1'], 'scope': 'Explicit formal invalidation, not only a platform request'}), 'current blocker')

    def test_formal_workflow_blocker_still_blocks(self):
        self.assert_rejected(lambda state: state['blocking_items'].append({'id': 'FORMAL-REPAIR', 'blocks': ['FORMAL_1']}), 'current blocker')

    def nested_asset_scene(self, versions=('LOOK-1/STATE-BASE',)):
        self.state['character_profiles'] = [{'id': 'XUNING', 'height_cm': 168, 'version': 'CHAR-1'}]
        self.state['character_assets'] = [{'id': 'XUNING', 'version': 'CHAR-1', 'status': 'DONE', 'four_views': [{'version': value, 'ref': value + '.md'} for value in versions]}]
        self.seal()
        self.scene['actors'] = [{'id': 'proxy', 'height': 1.68}]
        self.scene['assetBindings'] = [{'actorId': 'proxy', 'assetId': 'XUNING', 'height_cm': 168, 'profile_version': 'CHAR-1', 'look_version': 'LOOK-1', 'state_version': 'STATE-BASE', 'representation': 'proxy'}]
        self.scene['sourceAssetIds']['characters'] = ['XUNING']

    def test_actual_upstream_nested_four_view_versions_bind(self):
        self.nested_asset_scene()
        self.assertTrue(self.check()['ok'])

    def test_nested_selected_version_change_is_stale(self):
        self.nested_asset_scene()
        self.state['character_assets'][0]['four_views'][0]['version'] = 'LOOK-2/STATE-BASE'
        self.save_state()
        self.assertIn('relevant character_assets', self.check(ok=False)['error'])

    def test_nested_unselected_variant_change_does_not_invalidate_selected_variant(self):
        self.nested_asset_scene(('LOOK-1/STATE-BASE', 'LOOK-2/STATE-ALT'))
        self.state['character_assets'][0]['four_views'][1]['ref'] = 'unrelated-variant-v2.md'
        self.save_state()
        self.assertTrue(self.check()['ok'])

    def test_nested_look_state_cannot_mix_different_variants(self):
        self.nested_asset_scene(('LOOK-1/STATE-BASE', 'LOOK-2/STATE-ALT'))
        self.scene['assetBindings'][0]['state_version'] = 'STATE-ALT'
        self.assertIn('no explicit character_assets provenance', self.check(ok=False)['error'])

    def test_nested_version_does_not_parse_free_form_story_text(self):
        self.nested_asset_scene(('Story mentions LOOK-1 and STATE-BASE without an explicit version token',))
        self.assertIn('look_version is missing', self.check(ok=False)['error'])

    def test_provenance_unknown_does_not_guess_from_state(self):
        packet = self.packet()
        provenance = packet['upstream_provenance']
        self.assertEqual(provenance['skill_version'], 'UNKNOWN')
        self.assertEqual(provenance['git_commit'], 'UNKNOWN')
        self.assertEqual(provenance['documents'], [])
        self.assertEqual(packet['upstream_snapshot']['state_version'], '1.9')

    def skill_fixture(self):
        skill = self.root / 'skill-package'
        (skill / 'references').mkdir(parents=True)
        (skill / 'SKILL.md').write_text('---\nname: script-to-storyboard-prompts\n---\n技能包版本：0.4.1。项目状态版本：1.9。\n', encoding='utf-8')
        (skill / 'references/transitions.md').write_text('SYNTHETIC: provenance-only package evidence.\n', encoding='utf-8')
        return skill

    def test_provenance_actual_documents_and_no_global_invalidation(self):
        skill = self.skill_fixture()
        packet = self.packet(skill)
        self.assertEqual(packet['upstream_provenance']['skill_version'], '0.4.1')
        self.assertEqual(packet['upstream_provenance']['git_commit'], 'UNKNOWN')
        documents = packet['upstream_provenance']['documents']
        self.assertEqual({row['path'] for row in documents}, {'SKILL.md', 'references/transitions.md'})
        for row in documents:
            self.assertEqual(row['sha256'], digest((skill / row['path']).read_bytes()))
        self.seal(packet)
        (skill / 'references/transitions.md').write_text('Package globally updated.\n', encoding='utf-8')
        current = prepare(self.state_file, self.upstream / 'budget.json', 'FORMAL_1', self.project / 'other.json', upstream_skill_dir=skill)
        self.assertNotEqual(current['upstream_provenance']['documents'], documents)
        self.assertEqual(current['state_scope'], packet['state_scope'])
        self.assertEqual(current['transition_context']['sha256'], packet['transition_context']['sha256'])
        self.assertTrue(self.check()['ok'])

    def test_bad_skill_directory_is_concrete_error(self):
        with self.assertRaisesRegex(ValueError, 'actual package directory containing SKILL.md'):
            self.packet(self.root / 'missing-package')
        skill = self.skill_fixture()
        (skill / 'SKILL.md').write_text('---\nname: wrong-package\n---\n', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'does not name script-to-storyboard-prompts'):
            upstream_provenance(skill)

    def test_cli_skill_option_and_overwrite_protection(self):
        skill = self.skill_fixture()
        arguments = [sys.executable, '-B', '-X', 'utf8', REPO / 'scripts/intake_storyboard.py', '--state', self.state_file, '--budget', self.upstream / 'budget.json', '--formal-id', 'FORMAL_1', '--out', self.intake, '--upstream-skill-dir', skill]
        self.command(arguments)
        original = self.intake.read_bytes()
        packet = load(self.intake)
        self.assertEqual(packet['upstream_provenance']['skill_version'], '0.4.1')
        self.assertIn('already exists', self.command(arguments, ok=False).stderr)
        self.assertEqual(original, self.intake.read_bytes())

    def manual_packet(self):
        packet = self.packet()
        draft = {key: copy.deepcopy(packet[key]) for key in ('project_id', 'formal_id', 'prompt_version', 'budget_version', 'production_settings', 'budget', 'upstream_snapshot')}
        draft['sources'] = [{'role': role, 'path': reference} for role, reference in [('state', 'state.json'), ('budget', 'budget.json'), ('master', 'master.md#formal-1'), ('source_script', 'script.md#source'), ('text_evidence', 'checks.md#formal-1')]]
        draft_file = self.upstream / 'manual-draft.json'
        dump(draft_file, draft)
        before = tree_hashes(self.upstream)
        sealed = finalize(draft_file, self.intake)
        self.assertEqual(before, tree_hashes(self.upstream))
        return sealed

    def test_new_manual_fragments_and_provenance(self):
        packet = self.seal(self.manual_packet())
        self.assertEqual(packet['adapter_version'], '0.6.1')
        self.assertEqual(packet['validation_profile'], 'MANUAL_EVIDENCE_V1')
        self.assertEqual(packet['upstream_provenance']['skill_version'], 'UNKNOWN')
        self.assertTrue(self.check()['ok'])
        for name in ('master.md', 'script.md', 'checks.md'):
            file = self.upstream / name
            file.write_text(file.read_text(encoding='utf-8').replace('Unrelated', 'UNRELATED changed').replace('unrelated segment.', 'unrelated segment CHANGED.'), encoding='utf-8')
        self.assertTrue(self.check()['ok'])

    def test_legacy_manual_fragment_full_hash_stays_conservative(self):
        packet = self.manual_packet()
        packet.update(adapter_version='0.4.0')
        packet.pop('transition_context')
        packet.pop('upstream_provenance')
        for row in packet['sources']:
            if row.get('selector', {}).get('kind') == 'MARKDOWN_FRAGMENT_V1':
                row['fragment'] = row.pop('selector')['fragment']
                row.pop('selected_sha256')
        self.seal(packet)
        self.assertTrue(self.check()['ok'])
        file = self.upstream / 'master.md'
        file.write_text(file.read_text(encoding='utf-8').replace('unrelated segment.', 'unrelated segment CHANGED.'), encoding='utf-8')
        self.assertIn('master source changed', self.check(ok=False)['error'])

    def test_manual_cli_accepts_skill_directory(self):
        self.manual_packet()
        skill = self.skill_fixture()
        self.command([sys.executable, '-B', '-X', 'utf8', REPO / 'scripts/finalize_manual_intake.py', '--draft', self.upstream / 'manual-draft.json', '--out', self.intake, '--upstream-skill-dir', skill])
        self.assertEqual(load(self.intake)['upstream_provenance']['skill_version'], '0.4.1')

    def test_unsupported_legacy_json_is_not_silently_upgraded(self):
        packet = self.packet()
        packet.pop('state_scope')
        packet.pop('validation_profile')
        self.seal(packet)
        self.assertIn('legacy STATE_JSON intake lacks scoped authority', self.check(ok=False)['error'])

    def test_bom_crlf_fragments_still_bind(self):
        for name in ('state.json', 'master.md', 'script.md', 'checks.md'):
            file = self.upstream / name
            file.write_bytes(b'\xef\xbb\xbf'+file.read_text(encoding='utf-8').replace('\n', '\r\n').encode('utf-8'))
        # Do not resave the BOM state when sealing this exact-file regression.
        packet = prepare(self.state_file, self.upstream / 'budget.json', 'FORMAL_1', self.intake)
        self.seal(packet)
        self.assertTrue(self.check()['ok'])

    def test_v18_state_is_read_without_migration(self):
        self.state.update(state_version='1.8', workflow_schema='SINGLE_TEXT_CONFIRMED_ASSET_STAGES_V3')
        packet = self.seal()
        self.assertEqual(packet['upstream_snapshot']['state_version'], '1.8')
        self.assertEqual(packet['validation_profile'], 'SCOPED_STATE_V3')
        self.assertTrue(self.check()['ok'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
