"""Generic intake regressions use local synthetic narrative artifacts, never DONE/PASS state."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'scripts'))
from storyboard_contract import create_packet, selection_sha256
from finalize_manual_intake import finalize


def digest(value):
    return hashlib.sha256(value).hexdigest()


class StoryboardContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='generic-storyboard-')
        self.root = Path(self.temp.name) / '中文 来源'
        self.root.mkdir()
        self.input = self.root / 'source.json'
        self.master = self.root / '导演稿.md'
        self.master.write_text('# 夜车\n\n车窗掠过树影。\n\n## 镜一\n近景，女孩抬头。\n\n## 镜二\n车窗反射灯光。\n', encoding='utf-8')
        self.source = {'schema_version': 'PREVIS_STORYBOARD_SOURCE_V1', 'id': '夜车-片段甲',
                       'time_basis': 'SEGMENT', 'duration_s': 7.5,
                       'shots': [{'id': '开场 01', 'start_s': 0, 'end_s': 2.25},
                                 {'id': '反光/02', 'start_s': 2.25, 'end_s': 7.5}],
                       'master': {'path': '导演稿.md'},
                       'production_settings': {'video_aspect_ratio': '16:9', 'visual_style': '水彩'},
                       'asset_catalog': {'actors': [{'id': '女孩', 'anchors': '红围巾'}],
                                         'scenes': [{'id': '夜车厢'}], 'props': []}}
        self.output = self.root / '下游 工程' / 'upstream-intake.json'
        self.save()

    def tearDown(self):
        self.temp.cleanup()

    def save(self):
        self.input.write_text(json.dumps(self.source, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    def cli(self, *args, ok=True):
        result = subprocess.run([sys.executable, '-B', '-X', 'utf8', REPO / 'scripts/intake_storyboard.py', *map(str, args)],
                                cwd=REPO, capture_output=True, text=True, encoding='utf-8', timeout=30)
        self.assertEqual(result.returncode == 0, ok, result.stdout + result.stderr)
        return result

    def test_explicit_generic_source_preserves_ids_and_actual_text_without_workflow(self):
        before = {p.name: digest(p.read_bytes()) for p in self.root.iterdir() if p.is_file()}
        packet = create_packet(self.input, self.output)
        self.assertEqual(packet['schema_version'], 'PREVIS_STORYBOARD_ADAPTER_V1')
        self.assertEqual(packet['adapter_version'], '0.7.0')
        self.assertEqual(packet['provider'], 'storyboard')
        self.assertEqual(packet['unit']['id'], self.source['id'])
        self.assertEqual(packet['master']['text'], self.master.read_text(encoding='utf-8'))
        self.assertEqual(packet['budget']['shots'][0]['duration_s'], 2.25)
        self.assertEqual(packet['asset_catalog']['actors'][0], self.source['asset_catalog']['actors'][0])
        self.assertEqual(packet['source_snapshot'], self.source)
        self.assertEqual(packet['lineage']['source_revision'], digest(self.input.read_bytes()))
        self.assertEqual(packet['lineage']['unit_revision'], selection_sha256(packet['selection']))
        self.assertFalse(packet['upstream_writes'])
        self.assertEqual(packet['semantic_review'], 'NOT_RUN')
        for field in ('formal_id', 'prompt_version', 'budget_version', 'upstream_snapshot'):
            self.assertNotIn(field, packet)
        self.assertNotIn('height_cm', packet['asset_catalog']['actors'][0])
        self.assertEqual(before, {p.name: digest(p.read_bytes()) for p in self.root.iterdir() if p.is_file()})

    def test_project_cli_and_overwrite_protection(self):
        self.cli('--project', self.input, '--out', self.output)
        before = self.output.read_bytes()
        self.assertEqual(json.loads(before)['input_mode'], 'STORYBOARD_JSON')
        self.assertIn('already exists', self.cli('--project', self.input, '--out', self.output, ok=False).stderr)
        self.assertEqual(before, self.output.read_bytes())

    def test_transcription_remains_mapping_without_source_authority(self):
        self.source['schema_version'] = 'PREVIS_STORYBOARD_DRAFT_V1'
        self.source['assumptions'] = [{'scope': 'proxy height', 'value': 1.7, 'basis': 'LOCAL_EXECUTION_ASSUMPTION'}]
        self.save()
        self.cli('--draft', self.input, '--out', self.output)
        packet = json.loads(self.output.read_text(encoding='utf-8'))
        self.assertEqual(packet['input_mode'], 'STORYBOARD_TRANSCRIPTION')
        self.assertEqual(packet['structural_status'], 'MAPPED_ONLY')
        self.assertEqual(packet['assumptions'], self.source['assumptions'])
        self.assertEqual(finalize(self.input, self.output)['schema_version'], packet['schema_version'])
        with self.assertRaisesRegex(ValueError, 'SOURCE_V1'):
            create_packet(self.input, self.output)

    def test_missing_optional_settings_versions_and_states_are_not_fabricated(self):
        self.source.pop('production_settings')
        self.source.pop('asset_catalog')
        self.save()
        packet = create_packet(self.input, self.output)
        self.assertEqual(packet['production_settings'], {})
        self.assertEqual(packet['states'], {'start_state': None, 'end_state': None})
        self.assertEqual(packet['asset_catalog'], {'actors': [], 'scenes': [], 'props': []})
        self.assertNotIn('version', packet['lineage'])
        self.assertEqual(len(packet['diagnostics']), 4)

    def test_explicit_versions_states_and_extensions_are_preserved(self):
        self.source.update(project_id='用户原项目', version='revision-A', start_state={'door': 'closed'}, end_state={'door': 'open'})
        self.source['shots'][0]['camera'] = {'framing': 'close', 'note': '保留作者字段'}
        self.save()
        packet = create_packet(self.input, self.output)
        self.assertEqual(packet['lineage']['project_id'], '用户原项目')
        self.assertEqual(packet['lineage']['version'], 'revision-A')
        self.assertEqual(packet['selection']['shots'][0]['camera'], self.source['shots'][0]['camera'])
        self.assertEqual(packet['states']['end_state'], {'door': 'open'})

    def test_master_markdown_fragment_and_bom_crlf_preserve_actual_selected_text(self):
        self.source['master']['path'] = '导演稿.md#镜一'
        self.save()
        self.master.write_bytes(b'\xef\xbb\xbf' + '# 夜车\r\n\r\n## 镜一\r\n女孩抬头。\r\n\r\n## 镜二\r\n其他内容。\r\n'.encode('utf-8'))
        packet = create_packet(self.input, self.output)
        self.assertIn('女孩抬头。', packet['master']['text'])
        self.assertNotIn('其他内容', packet['master']['text'])
        self.assertNotIn('\r', packet['master']['text'])
        row = next(row for row in packet['sources'] if row['role'] == 'master')
        self.assertEqual(row['selector']['fragment'], '镜一')
        self.assertEqual(row['selected_sha256'], digest(packet['master']['text'].strip().encode('utf-8')))

    def test_extra_local_evidence_fragment(self):
        (self.root / '资产.md').write_text('# 角色\n红围巾。\n# 场景\n车厢。\n', encoding='utf-8')
        packet = create_packet(self.input, self.output, additional_sources=['asset_prompt=资产.md#角色'])
        row = packet['sources'][-1]
        self.assertEqual(row['role'], 'asset_prompt')
        self.assertEqual(row['selector']['fragment'], '角色')
        self.assertEqual(row['selected_sha256'], digest('红围巾。'.encode('utf-8')))

    def test_bad_timing_and_duplicate_ids_rejected(self):
        for mutate in (lambda s: s['shots'][1].update(start_s=2),
                       lambda s: s['shots'][1].update(end_s=8),
                       lambda s: s['shots'][1].update(id=s['shots'][0]['id']),
                       lambda s: s.update(time_basis='SCENE'),
                       lambda s: s['shots'][0].update(start_s=True),
                       lambda s: s['shots'][0].update(duration_s=1)):
            with self.subTest(mutate=mutate):
                value = copy.deepcopy(self.source)
                mutate(value)
                self.input.write_text(json.dumps(value), encoding='utf-8')
                with self.assertRaises(ValueError):
                    create_packet(self.input, self.output)

    def test_empty_missing_remote_or_ambiguous_master_rejected(self):
        for reference in ('missing.md', 'https://example.org/director.md', '导演稿.md#missing-heading'):
            with self.subTest(reference=reference):
                self.source['master']['path'] = reference
                self.save()
                with self.assertRaises((ValueError, OSError)):
                    create_packet(self.input, self.output)
        self.source['master']['path'] = '导演稿.md'
        self.master.write_text('\n ', encoding='utf-8')
        self.save()
        with self.assertRaisesRegex(ValueError, 'empty'):
            create_packet(self.input, self.output)

    def test_bad_numbers_and_duplicate_json_keys_rejected(self):
        self.input.write_text('{"schema_version":"PREVIS_STORYBOARD_SOURCE_V1","id":"a","id":"b"}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON key'):
            create_packet(self.input, self.output)
        self.input.write_text('{"number":NaN}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Non-finite'):
            create_packet(self.input, self.output)
        self.source['external_count'] = 9007199254740993
        self.save()
        with self.assertRaisesRegex(ValueError, 'numeric range'):
            create_packet(self.input, self.output)

    def test_explicit_height_fields_must_agree(self):
        actor = self.source['asset_catalog']['actors'][0]
        actor.update(height_cm=168, height_m=1.68)
        self.save()
        packet = create_packet(self.input, self.output)
        self.assertEqual(packet['asset_catalog']['actors'][0]['height_cm'], 168)
        actor['height_m'] = 1.7
        self.save()
        with self.assertRaisesRegex(ValueError, 'conflict'):
            create_packet(self.input, self.output)

    def test_old_workflow_cli_arguments_and_schema_are_rejected(self):
        result = self.cli('--project', self.input, '--formal-id', 'pretend', '--out', self.output, ok=False)
        self.assertIn('unrecognized arguments', result.stderr)
        for old_schema in ('STORYBOARD_PREVIS_ADAPTER_V1', 'RUN_STATE_V4', '1.9'):
            self.source['schema_version'] = old_schema
            self.save()
            with self.assertRaisesRegex(ValueError, 'PREVIS_STORYBOARD_SOURCE_V1'):
                create_packet(self.input, self.output)
        result = self.cli('--project', self.input, '--state', self.input, '--budget', self.input,
                          '--out', self.output, ok=False)
        self.assertIn('unrecognized arguments', result.stderr)

    def test_canonical_numeric_equivalence_and_unicode_key_order(self):
        self.assertEqual(selection_sha256({'中文': 9, '😀': -0.0, '𐀀': 1e-7}),
                         selection_sha256({'𐀀': 0.0000001, '😀': 0, '中文': 9.0}))
        self.assertNotEqual(selection_sha256({'a': 1}), selection_sha256({'a': '1'}))


if __name__ == '__main__':
    unittest.main(verbosity=2)
