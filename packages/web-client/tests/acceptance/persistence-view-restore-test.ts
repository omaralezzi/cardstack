import { module, test } from 'qunit';
import { settled, visit } from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';

import { setupMirage } from 'ember-cli-mirage/test-support';
import prepaidCardColorSchemes from '../../mirage/fixture-data/prepaid-card-color-schemes';
import prepaidCardPatterns from '../../mirage/fixture-data/prepaid-card-patterns';

import { MirageTestContext } from 'ember-cli-mirage/test-support';
import { DepotSafe } from '@cardstack/cardpay-sdk';
import { BN } from 'bn.js';
import { faceValueOptions } from '@cardstack/web-client/components/card-pay/issue-prepaid-card-workflow/workflow-config';
import Layer2TestWeb3Strategy from '@cardstack/web-client/utils/web3-strategies/test-layer2';
import { toWei } from 'web3-utils';

import WorkflowPersistence from '@cardstack/web-client/services/workflow-persistence';

interface Context extends MirageTestContext {}

let workflowPersistenceService: WorkflowPersistence;

module('Acceptance | persistence view and restore', function (hooks) {
  setupApplicationTest(hooks);
  setupMirage(hooks);

  hooks.beforeEach(async function () {
    (this as any).server.db.loadData({
      prepaidCardColorSchemes,
      prepaidCardPatterns,
    });
    window.TEST__AUTH_TOKEN = 'abc123--def456--ghi789';
    let layer2AccountAddress = '0x182619c6Ea074C053eF3f1e1eF81Ec8De6Eb6E44';

    // FIXME what of the below and above is unnecessary?

    const MIN_AMOUNT_TO_PASS = new BN(
      toWei(`${Math.ceil(Math.min(...faceValueOptions) / 100)}`)
    );
    let layer2Service = this.owner.lookup('service:layer2-network')
      .strategy as Layer2TestWeb3Strategy;
    layer2Service.test__simulateAccountsChanged([layer2AccountAddress]);
    let testDepot = {
      address: '0xB236ca8DbAB0644ffCD32518eBF4924ba8666666',
      tokens: [
        {
          balance: MIN_AMOUNT_TO_PASS.toString(),
          token: {
            symbol: 'DAI',
          },
        },
        {
          balance: '500000000000000000000',
          token: {
            symbol: 'CARD',
          },
        },
      ],
    };
    await layer2Service.test__simulateDepot(testDepot as DepotSafe);
    layer2Service.authenticate();
    layer2Service.test__simulateHubAuthentication('abc123--def456--ghi789');

    workflowPersistenceService = this.owner.lookup(
      'service:workflow-persistence'
    );

    workflowPersistenceService.clear();
  });

  test('it lists persisted workflows', async function (this: Context, assert) {
    for (let i = 0; i < 4; i++) {
      workflowPersistenceService.persistData(`persisted-${i}`, {
        name: `Prepaid Card Issuance ${i}`,
        state: {
          name: 'PREPAID_CARD_ISSUANCE',
          state: {
            completedCardNames: ['LAYER2_CONNECT', 'HUB_AUTH'],
            completedMilestonesCount: 1,
            milestonesCount: 4,
          },
        },
      });
    }

    await visit('/card-pay/');
    assert.dom('[data-test-workflow-tracker]').containsText('4');

    workflowPersistenceService.clear();
    await settled();
    assert.dom('[data-test-workflow-tracker]').containsText('0');
  });
});
