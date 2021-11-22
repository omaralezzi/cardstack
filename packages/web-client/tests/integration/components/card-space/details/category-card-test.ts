import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { click, fillIn, render } from '@ember/test-helpers';
import hbs from 'htmlbars-inline-precompile';
import { WorkflowSession } from '@cardstack/web-client/models/workflow';
import { OPTIONS } from '@cardstack/web-client/components/card-space/edit-details/category';

module(
  'Integration | Component | card-space/edit-details/category',
  function (hooks) {
    setupRenderingTest(hooks);

    test('it lists the allowed categories and persists the choice to the workflow session', async function (assert) {
      let workflowSession = new WorkflowSession();
      this.set('workflowSession', workflowSession);

      await render(hbs`
        <CardSpace::EditDetails::Category
          @workflowSession={{this.workflowSession}}
        />
      `);

      assert.dom('radio-option__input--checked').doesNotExist();

      OPTIONS.forEach(function (buttonText, index) {
        assert
          .dom(`[data-test-category-option]:nth-child(${index + 1})`)
          .hasText(buttonText);
      });

      await click(`[data-test-category-option]:nth-child(2)`);

      assert.equal(workflowSession.getValue<string>('category'), OPTIONS[1]);
      assert.dom('[data-test-category-option]:nth-child(2) input').isChecked();
    });

    test('it allows a custom category to be entered', async function (assert) {
      let workflowSession = new WorkflowSession();
      this.set('workflowSession', workflowSession);

      await render(hbs`
        <CardSpace::EditDetails::Category
          @workflowSession={{this.workflowSession}}
        />
      `);

      assert
        .dom(`[data-test-category-option]:nth-child(${OPTIONS.length + 1})`)
        .containsText('Other');

      assert
        .dom(
          `[data-test-category-option]:nth-child(${
            OPTIONS.length + 1
          }) [data-test-category-option-other]`
        )
        .exists();

      await fillIn('[data-test-category-option-other]', 'Something');

      assert
        .dom(
          `[data-test-category-option]:nth-child(${OPTIONS.length + 1}) input`
        )
        .hasClass('radio-option__input--checked');

      assert.equal(workflowSession.getValue<string>('category'), 'Something');

      await click('[data-test-category-option]:nth-child(2)');
      assert.dom('[data-test-category-option-other]').hasValue('Something');

      await click(
        `[data-test-category-option]:nth-child(${OPTIONS.length + 1})`
      );
      assert.equal(workflowSession.getValue<string>('category'), 'Something');
    });

    test('it restores input from session', async function (assert) {
      let workflowSession = new WorkflowSession();
      this.set('workflowSession', workflowSession);
      workflowSession.setValue('category', OPTIONS[1]);

      await render(hbs`
        <CardSpace::EditDetails::Category
          @workflowSession={{this.workflowSession}}
        />
      `);

      assert
        .dom('[data-test-category-option]:nth-child(2) input')
        .hasClass('radio-option__input--checked');
    });

    test('it restores custom input from session', async function (assert) {
      let workflowSession = new WorkflowSession();
      this.set('workflowSession', workflowSession);
      workflowSession.setValue('category', 'Hello');

      await render(hbs`
        <CardSpace::EditDetails::Category
          @workflowSession={{this.workflowSession}}
        />
      `);

      assert
        .dom(
          `[data-test-category-option]:nth-child(${OPTIONS.length + 1}) input`
        )
        .hasClass('radio-option__input--checked');

      assert.dom('[data-test-category-option-other]').hasValue('Hello');
    });
  }
);
