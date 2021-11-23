import { setComponentTemplate } from '@ember/component';
import { precompileTemplate } from '@ember/template-compilation';
import templateOnlyComponent from '@ember/component/template-only';
import BoxelField from '@cardstack/boxel/components/boxel/field';
import './edit.css';

export default setComponentTemplate(
  precompileTemplate(
    `<section class="links-edit">
      <header class="links-edit__header">Links</header>
      <ul class="links-edit__list">
        {{#each @fields.links as |Field|}}
          <li><Field /></li>
        {{/each}}
      </ul>
    </section>`,
    {
      strictMode: true,
      scope: () => ({ BoxelField }),
    }
  ),
  templateOnlyComponent()
);
