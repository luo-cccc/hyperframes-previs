"""Current 1.3 layers exercised through Python sealing and the real JS consumer."""
import copy
from test_fight_contract import FightFixture, fight, json_bytes


class LayeredFight(FightFixture):
    def setUp(self):
        super().setUp()
        p = self.project
        p['tracks'] = [
            {'id': 'sy_line_world', 'kind': 'world', 'name': '石阶外层', 'time_relation': '外界持续行动。'},
            {'id': 'sy_line_inner', 'kind': 'inner', 'name': '内景', 'time_relation': '内外同时推进。'},
        ]
        for beat in p['beats']:
            beat['track'] = 'sy_line_inner' if beat['id'] == 'sy_cross' else 'sy_line_world'
        for index, shot in enumerate(p['shots']):
            shot['track'] = 'sy_line_inner' if index in (1, 2) else 'sy_line_world'
            if index in (1, 2):
                shot['outer_state'] = '外层身体仍在下阶，铜环持续下落。' if index == 1 else '外层铜环落地，身体保持站立。'
        p['shots'][1]['opening_state'] = '内景铜环凝在掌中。'
        p['segments'][1]['opening_state'] = p['shots'][1]['opening_state']
        p['shots'][3]['opening_state'] = p['shots'][2]['outer_state']
        p['segments'][2]['opening_state'] = p['shots'][3]['opening_state']
        p['assets'][0]['anchors'].append('额前一颗青珠')
        p['assets'][1]['anchors'].append('额前一颗青珠')
        p['vfx'] = [{'id': 'sy_signature', 'owner': 'sy_actor_a', 'name': '环边青光', 'layer': 'world', 'scale': 'body', 'function': '显示本次行动的余量。', 'look': '一圈薄青光。', 'lifecycle': {'release': '青光点亮。', 'fade': '青光随松手暗下。'}, 'spends': '消耗一缕灵力。', 'route': 'one_pass', 'shot_ids': ['sy_shot_b', 'sy_shot_c']}]
        p['forms'] = [{'id': 'sy_form', 'actor': 'sy_actor_a', 'from_asset': 'sy_actor_a', 'to_asset': 'sy_actor_b', 'beat_id': 'sy_cross', 'shot_ids': ['sy_shot_b', 'sy_shot_c'], 'method': 'occlusion', 'ladder': ['青珠先亮。', '雾遮轮廓。', '灰翼轮廓落定。'], 'shared_anchors': ['额前一颗青珠'], 'cost_id': 'sy_cost_a', 'duration': '形态持续至场终。', 'exit': '本场不退出。'}]
        p['transitions'] = [
            {'id': 'sy_enter', 'from_shot': 'sy_shot_a', 'to_shot': 'sy_shot_b', 'method': 'match_graphic', 'layer': 'world', 'keeps': ['铜环轮廓。'], 'changes': ['内外空间。'], 'cut_condition': '环边合拢时切。', 'route': 'cut'},
            {'id': 'sy_exit', 'from_shot': 'sy_shot_c', 'to_shot': 'sy_shot_d', 'method': 'sound_bridge', 'layer': 'world', 'keeps': ['衣料余响。'], 'changes': ['回到石阶。'], 'cut_condition': '青光熄灭时切。', 'route': 'cut'},
        ]
        self.write_source()

    def test_all_layers_survive_seal_and_actual_consumer(self):
        packet = self.packet()
        self.assertEqual(packet['validation_profile'], 'FIGHT_SELECTED_SCOPE_V2')
        for key in ('tracks', 'vfx', 'forms', 'transitions'):
            self.assertEqual(packet['selection'][key], self.project[key])
        self.assertIn('青光随松手暗下。', packet['master']['text'])
        self.assertIn('灰翼轮廓落定。', packet['master']['text'])
        self.assertIn('环边合拢时切。', packet['master']['text'])
        self.assertTrue(any('/shared_anchors/' in row['pointer'] for row in packet['master']['fragments']))
        self.assertEqual(self.node()['selected_sha256'], packet['source_selection']['selected_sha256'])

    def test_duration_and_exit_are_director_text_not_copyable_execution(self):
        self.project['forms'][0].update(duration='持续2秒', exit='8秒时退出。')
        self.write_source()
        self.packet()
        self.node()

    def test_duplicate_shared_anchor_rejected(self):
        self.invalid_layer(lambda p: p['forms'][0]['shared_anchors'].append('额前一颗青珠'), 'duplicate')

    def test_transition_id_checks_original_endpoints_and_frames(self):
        self.packet()
        result = self.node(transition_id='sy_enter')
        self.assertEqual(result['scoped_transition']['status'], 'CURRENT')
        record = next(row for row in result['transitions']['connections'] if row['id'] == 'sy_enter')
        self.assertEqual({row['shot_id'] for row in record['endpoints']}, {'sy_shot_a', 'sy_shot_b'})
        self.assertEqual(record['expected_sha256'], record['current_sha256'])
        self.assertTrue(all(row['revision'].startswith('sha256:') for row in record['endpoints']))
        self.assertEqual(self.node(transition_id='missing_transition')['scoped_transition']['status'], 'NOT_DECLARED')

    def test_transition_endpoint_keyframe_change_invalidates_scope(self):
        packet = self.packet()
        self.assertIn('sy_frame_d', {row['id'] for row in packet['selection']['keyframes']})
        self.project['keyframes'][-1]['state'] += ' 变更终态帧。'
        self.write_source()
        self.assertEqual(self.node(False)['code'], 'FIGHT_SOURCE_CHANGED')

    def invalid_layer(self, mutate, message):
        self.packet()
        mutate(self.project)
        with self.assertRaisesRegex(fight.FightContractError, message):
            fight.validate_project(self.project)
        self.write_source()
        self.node(False)

    def test_return_world_uses_latest_outer_state(self):
        self.invalid_layer(lambda p: p['shots'][2].update(outer_state='不同的外层状态。'), 'outer_state')

    def test_inner_requires_outer_and_world_forbids_it(self):
        for index, mutate in ((1, lambda shot: shot.pop('outer_state')), (0, lambda shot: shot.update(outer_state='多写的外层。'))):
            with self.subTest(index=index):
                original = copy.deepcopy(self.project)
                self.invalid_layer(lambda p: mutate(p['shots'][index]), 'outer_state')
                self.project = original
                self.write_source()

    def test_shot_and_beat_tracks_must_agree(self):
        self.invalid_layer(lambda p: p['beats'][1].update(track='sy_line_world'), 'track|pivotal')

    def test_post_cannot_touch_world(self):
        self.invalid_layer(lambda p: p['vfx'][0].update(layer='post', lifecycle={'release': '点亮。', 'contact': '接触。'}), 'post')

    def test_form_identity_anchor_must_exist_in_both_assets(self):
        self.invalid_layer(lambda p: p['assets'][1]['anchors'].remove('额前一颗青珠'), 'shared_anchors')

    def test_form_cost_must_belong_to_actor(self):
        self.invalid_layer(lambda p: p['forms'][0].update(cost_id='sy_cost_b'), 'cost_id')

    def test_post_transition_cannot_cross_tracks(self):
        self.invalid_layer(lambda p: p['transitions'][0].update(layer='post'), 'post')

    def test_bridge_requires_both_high_risk(self):
        self.invalid_layer(lambda p: p['transitions'][0].update(route='bridge'), 'bridge')

    def test_layer_revision_and_endpoint_camera_invalidate_live_packet(self):
        for mutate in (
            lambda p: p['vfx'][0].update(look='另一种青光。'),
            lambda p: p['forms'][0]['ladder'].append('最后收束。'),
            lambda p: p['transitions'][1]['keeps'].append('环边亮点。'),
            lambda p: p['shots'][3].update(camera='新的切入机位。'),
        ):
            with self.subTest(mutate=mutate):
                original = copy.deepcopy(self.project)
                self.packet()
                mutate(self.project)
                fight.validate_project(self.project)
                self.write_source()
                self.assertEqual(self.node(False)['code'], 'FIGHT_SOURCE_CHANGED')
                self.project = original
                self.write_source()

    def test_old_adapter_and_scope_are_rejected(self):
        for key, value in (('adapter_version', '0.6.0'), ('validation_profile', 'FIGHT_SELECTED_SCOPE_V1')):
            packet = self.packet()
            packet[key] = value
            self.packet_file.write_bytes(json_bytes(packet))
            self.assertEqual(self.node(False)['code'], 'FIGHT_PACKET_INVALID')
