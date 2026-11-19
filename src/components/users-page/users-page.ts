import { BaseComponent } from '../../core/base-component.ts';
import { Store } from '../../core/store.ts';
import {
  createInitialUsersState,
  transitionUsers,
  type UsersAction,
  type UsersState,
} from '../../domain/user-machine.ts';
import { fetchUsers } from '../../services/user-service.ts';
import template from './users-page.html?raw';
import style from './users-page.css?raw';

/**
 * Loads users through a service, lists them, and adds new ones from a form.
 * Delegates all validation and state transitions to `src/domain/user-machine.ts`.
 */
export class UsersPageComponent extends BaseComponent {
  static tagName = 'users-page';
  private store = new Store<UsersState>(createInitialUsersState());

  constructor() {
    super(template, style);
  }

  private dispatch(action: UsersAction): string {
    const { state, validationError } = transitionUsers(
      this.store.getState(),
      action
    );
    this.store.setState(state);
    return validationError;
  }

  async init() {
    const form = this.querySelector('#user-form');
    if (!(form instanceof HTMLFormElement)) return;
    const nameControl = form.elements.namedItem('name');
    const roleControl = form.elements.namedItem('role');
    if (
      !(nameControl instanceof HTMLInputElement) ||
      !(roleControl instanceof HTMLSelectElement)
    ) {
      return;
    }

    this.store.addEventListener('change', () => this.render());

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const validationError = this.dispatch({
        type: 'addUser',
        candidate: {
          name: nameControl.value,
          role: roleControl.value,
        },
      });

      // Report our domain rule through the browser's built-in validation UI.
      nameControl.setCustomValidity(validationError);
      if (!form.reportValidity()) return;

      form.reset();
      nameControl.focus();
    });
    nameControl.addEventListener('input', () =>
      nameControl.setCustomValidity('')
    );

    this.dispatch({ type: 'loadStarted' });
    try {
      const users = await fetchUsers();
      this.dispatch({ type: 'loadSucceeded', users });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.dispatch({ type: 'loadFailed', message });
    }
  }

  private render() {
    const { users, statusMessage } = this.store.getState();
    const statusEl = this.querySelector('#user-status');
    if (statusEl) statusEl.textContent = statusMessage;

    const itemTemplate = this.querySelector('#user-item-template');
    const userList = this.querySelector('#user-list');
    if (!(itemTemplate instanceof HTMLTemplateElement) || !userList) return;

    const items = users.map((user) => {
      const item = document.importNode(itemTemplate.content, true);
      const link = item.querySelector('.user-link');
      const role = item.querySelector('.user-role');
      if (link instanceof HTMLAnchorElement) {
        link.textContent = user.name;
        link.setAttribute('href', `/user/${encodeURIComponent(user.name)}`);
      }
      if (role) {
        role.textContent = user.role;
      }
      return item;
    });
    userList.replaceChildren(...items);
  }
}

if (!customElements.get(UsersPageComponent.tagName)) {
  customElements.define(UsersPageComponent.tagName, UsersPageComponent);
}
