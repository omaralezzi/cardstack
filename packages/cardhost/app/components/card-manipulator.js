import Component from '@glimmer/component';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { inject as service } from '@ember/service';
import { dasherize } from '@ember/string';
import { startCase } from 'lodash';
import { task } from 'ember-concurrency';
import ENV from '@cardstack/cardhost/config/environment';
import { fieldTypeMappings, fieldComponents } from '../utils/mappings';
import drag, { chooseNextToUp, chooseNextToDown, makeTarget } from '../motions/drag';
import move from 'ember-animated/motions/move';
import { printSprites } from 'ember-animated';

const LEFT_ARROW = 37;
const UP_ARROW = 38;
const RIGHT_ARROW = 39;
const DOWN_ARROW = 40;
const SPACE = 32;

const { environment } = ENV;

export default class CardManipulator extends Component {
  fieldTypeMappings = fieldTypeMappings;

  @service data;
  @service router;
  @service cardstackSession;
  @service cssModeToggle;
  @service draggable;

  @tracked statusMsg;
  @tracked card;
  @tracked selectedField;
  @tracked isDragging;
  @tracked cardId;
  @tracked cardSelected = true;
  @tracked fieldComponents = fieldComponents;

  constructor(...args) {
    super(...args);

    this.card = this.args.card;
  }

  get cardJson() {
    if (!this.card) {
      return null;
    }
    return JSON.stringify(this.card.json, null, 2);
  }

  get isDirtyStr() {
    return this.card.isDirty.toString();
  }

  get newFieldName() {
    /**
      Returns field name in the form field-12, incrementing from the highest
      existing field number. Ex: if the highest is field-15, this will return
      field-16. If there are no fields, it returns field-1.
    */
    let existingFields = this.card.isolatedFields.map(field => field.name);
    let autogeneratedFieldNames = existingFields.filter(item => /^field-\d+$/.test(item));
    let fieldNumbers = autogeneratedFieldNames.map(item => Number(item.split('-')[1]));
    let newNumber = fieldNumbers.length ? Math.max(...fieldNumbers) + 1 : 1;
    return `field-${newNumber}`;
  }

  get didUpdate() {
    if (this.args.card && !this.args.card.isNew && (!this.card || this.args.card.id !== this.card.id)) {
      this.card = this.args.card;
    }
    return null;
  }

  @action
  updateCard(element, [card]) {
    if (!card.isNew) {
      this.card = card;
    }
  }

  @task(function*() {
    this.statusMsg = null;
    try {
      yield this.card.delete();
    } catch (e) {
      console.error(e); // eslint-disable-line no-console
      this.statusMsg = `card ${this.card.name} was NOT successfully deleted: ${e.message}`;
      return;
    }
    this.router.transitionTo('index');
  })
  deleteCard;

  @action
  removeField(fieldNonce) {
    if (fieldNonce == null || !this.card) {
      return;
    }

    // using field nonce in order to be resiliant to the scenario where the user deletes the name of the field too
    let field = this.card.getFieldByNonce(fieldNonce);

    if (field === this.selectedField) {
      this.cardSelected = true;
    }

    field.remove();
  }

  @action
  addField(displayType, name, isEmbedded, value, position) {
    let type = displayType ? fieldTypeMappings[displayType] : null;
    if (!this.card || !type || !name) {
      return;
    }

    let field = this.card.addField({
      type,
      position,
      name: dasherize(name).toLowerCase(),
      neededWhenEmbedded: isEmbedded,
    });

    if (value != null) {
      field.setValue(value);
    }
  }

  @action
  setPosition(fieldName, position) {
    if (!fieldName || !this.card || position == null) {
      return;
    }

    let card = this.card;
    card.moveField(card.getField(fieldName), position);
  }

  @action
  setNeededWhenEmbedded(fieldName, neededWhenEmbedded, evt) {
    // this prevents 2-way data binding from trying to alter the Field
    // instance's neededWhenEmbedded value, which is bound to the input
    // that fired this action. Our data service API is very unforgiving when
    // you try to change the Field's state outside of the official API
    // (which is what ember is trying to do). Ember gets mad when it sees
    // that it can't alter the Field's state via the 2-way binding and
    // makes lots of noise. interestingly, this issue only seems to happen
    // when running tests. This work around has yucky visual side effects,
    // so only performing in the test env. A better solution would be to use/make
    // a one-way input control for setting the field.neededWhenEmbedded value.
    // The <Input> component is unfortunately, is not a one-way input helper
    if (environment === 'test') {
      evt.preventDefault();
    }

    this.card.getField(fieldName).setNeededWhenEmbedded(neededWhenEmbedded);
  }

  @action
  setFieldValue(fieldName, value) {
    if (!fieldName || !this.card) {
      return;
    }
    this.card.getField(fieldName).setValue(value);
  }

  @action
  setFieldName(oldFieldName, newFieldName) {
    this.card.getField(oldFieldName).setName(newFieldName);
    this.card.getField(newFieldName).setLabel(startCase(newFieldName));
  }

  @action
  setFieldLabel(fieldName, label) {
    this.card.getField(fieldName).setLabel(label);
  }

  @action
  setFieldInstructions(fieldName, instructions) {
    this.card.getField(fieldName).setInstructions(instructions);
  }

  @action
  preview() {
    this.router.transitionTo('cards.card.edit.layout', this.card);
  }

  @action
  delete() {
    this.deleteCard.perform();
  }

  @action
  initDrag() {
    this.isDragging = true;
  }

  @action dropField(position, onFinishDrop, evt) {
    let draggable = this.draggable.getField();

    if (!draggable) {
      return;
    }

    onFinishDrop();

    let field;

    if (draggable.name) {
      let fieldName = draggable.name;
      if (fieldName) {
        field = this.card.getField(fieldName);
        let newPosition = field.position < position ? position - 1 : position;
        this.setPosition(fieldName, newPosition);
      }
    } else {
      field = this.card.addField({
        type: this.fieldTypeMappings[draggable.type],
        position: position,
        name: this.newFieldName,
        neededWhenEmbedded: false,
      });
    }

    this.draggable.clearField();
    this.draggable.clearDropzone();

    if (field) {
      this.selectField(field, evt);
    }
  }

  @action selectField(field, evt) {
    if (field && field.isDestroyed) {
      return;
    }

    // Toggling the selected field in tests is baffling me, using something more brute force
    if (environment === 'test' && this.selectedField === field) {
      return;
    }

    // we have to focus the clicked element to take focus away from the card.
    // to do that we have to give the element tabindex = 0 temporarily.
    // but if the element already has a tabindex (i.e. an input), we need
    // to make sure not to clobber it's original tabindex
    let tabIndex = evt.target.tabIndex;
    if (tabIndex === -1) {
      evt.target.tabIndex = 0;
      evt.target.focus();
      evt.target.blur();
      evt.target.tabIndex = tabIndex;
    } else {
      evt.target.focus();
    }

    this.selectedField = field;
    this.cardSelected = false;
  }

  @action startDragging(field, evt) {
    evt.dataTransfer.setData('text', evt.target.id);
    evt.dataTransfer.setData('text/type', field.type);
  }

  @action
  activateKeyboardNav() {
    document.querySelector('.ch-catalog--fields .ch-catalog-field').focus();
  }

  @action
  handleKey(field, event) {
    let activeField = this.fieldComponents.find(field => field.dragState);

    if (activeField) {
      let xStep = 0;
      let yStep = 0;
      switch (event.keyCode) {
        case RIGHT_ARROW:
          xStep = 1;
          break;
        case LEFT_ARROW:
          xStep = -1;
          break;
        case DOWN_ARROW:
          yStep = 1;
          break;
        case UP_ARROW:
          yStep = -1;
          break;
        case SPACE:
          activeField.set('dragState', null);
          event.stopPropagation();
          return false;
      }
      if (xStep || yStep) {
        activeField.dragState.xStep += xStep;
        activeField.dragState.yStep += yStep;
        event.stopPropagation();
        return false;
      }
    } else {
      let elements = [...document.querySelectorAll('.ch-catalog--fields .ch-catalog-field')].filter(
        element => element !== event.target
      );
      let targets = [...elements].map(element => makeTarget(element.getBoundingClientRect(), element));
      let currentTarget = makeTarget(event.target.getBoundingClientRect(), event.target);
      let nextTarget;

      switch (event.keyCode) {
        case DOWN_ARROW:
          nextTarget = chooseNextToDown(currentTarget, targets);
          break;
        case UP_ARROW:
          nextTarget = chooseNextToUp(currentTarget, targets);
          break;
        case SPACE:
          this.beginDragging(field, event);
          event.stopPropagation();
          return false;
      }
      if (nextTarget) {
        nextTarget.payload.focus();
        event.stopPropagation();
        return false;
      }
    }
  }

  @action
  selectFieldType(field) {
    if (!this.draggable.isDragging()) {
      this.draggable.setField(field);
    } else {
      this.draggable.setDragging(false);
    }
  }

  @action
  beginDragging(field, dragEvent) {
    let dragState;
    let draggableService = this.draggable;

    function stopMouse() {
      field.dragState = null;
      let dropzone = draggableService.getDropzone();
      if (dropzone) {
        draggableService.drop();
      }
      window.removeEventListener('mouseup', stopMouse);
      window.removeEventListener('mousemove', updateMouse);
      return false;
    }

    function updateMouse(event) {
      dragState.latestPointerX = event.x;
      dragState.latestPointerY = event.y;

      draggableService.setDragging(true);

      // in order for the drop zone to trigger a mouseenter/mouseleave event
      // we need to temporarily hide the dragged element
      let fieldEl = dragEvent.target.closest('.ch-catalog-field');
      fieldEl.style.visibility = 'hidden';
      let elemBelow = document.elementFromPoint(event.clientX, event.clientY);
      fieldEl.style.visibility = 'visible';

      let currentDropzone = draggableService.getDropzone();
      let dropzoneBelow = elemBelow.closest('.drop-zone');

      if (currentDropzone !== dropzoneBelow) {
        if (currentDropzone) {
          draggableService.clearDropzone();
        }
        if (dropzoneBelow) {
          draggableService.setDropzone(elemBelow);
        }
      }
    }

    if (dragEvent instanceof KeyboardEvent) {
      // This is a keyboard-controlled "drag" instead of a real mouse
      // drag.
      dragState = {
        usingKeyboard: true,
        xStep: 0,
        yStep: 0,
      };
    } else {
      dragState = {
        usingKeyboard: false,
        initialPointerX: dragEvent.x,
        initialPointerY: dragEvent.y,
        latestPointerX: dragEvent.x,
        latestPointerY: dragEvent.y,
      };
      window.addEventListener('mouseup', stopMouse);
      window.addEventListener('mousemove', updateMouse);
    }
    field.dragState = dragState;
    this.draggable.setField(field);
    this.fieldComponents = this.fieldComponents.map(obj => (obj.id === field.id ? field : obj)); // oh glimmer, you so silly...
  }

  *transition({ keptSprites }) {
    printSprites(arguments[0], 'cardTransition');
    let activeSprite = keptSprites.find(sprite => sprite.owner.value.dragState);
    let others = keptSprites.filter(sprite => sprite !== activeSprite);
    if (activeSprite) {
      drag(activeSprite, {
        others,
      });
    }
    others.forEach(move);
  }
}
