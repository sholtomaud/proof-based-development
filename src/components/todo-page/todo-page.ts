import { BaseComponent } from '../../core/base-component.ts';
import { Store } from '../../core/store.ts';
import {
  isTodoFilter,
  type Task,
  type TodoFilter,
} from '../../shared/contracts.ts';
import {
  createInitialTodoState,
  parsePersistedTodoState,
  selectFilteredTasks,
  selectTodoCounts,
  transitionTodo,
  type TodoAction,
  type TodoState,
} from '../../domain/todo-machine.ts';
import template from './todo-page.html?raw';
import style from './todo-page.css?raw';

const STORAGE_KEY = 'boba-todo-state';

function loadInitialTodoState(): TodoState {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return createInitialTodoState();
  try {
    const parsed: unknown = JSON.parse(saved);
    return parsePersistedTodoState(parsed);
  } catch {
    return createInitialTodoState();
  }
}

export class TodoPageComponent extends BaseComponent {
  static tagName = 'todo-page';
  private store: Store<TodoState>;

  constructor() {
    super(template, style);
    this.store = new Store<TodoState>(loadInitialTodoState());
  }

  private dispatch(action: TodoAction): void {
    const next = transitionTodo(this.store.getState(), action);
    this.store.setState(next);
  }

  init() {
    // Subscribe to the store for automatic declarative updates
    this.store.addEventListener('change', () => {
      // Persist state to localStorage
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.store.getState()));
      this.renderTasks();
    });

    // Register delegated event listeners (they survive DOM updates perfectly!)
    this.delegate('click', '#add-task-btn', () => this.addTask());
    this.delegate('keypress', '#new-task-input', (event) => {
      if (event instanceof KeyboardEvent && event.key === 'Enter') {
        this.addTask();
      }
    });
    this.delegate('click', '.toggle-task', (_, el) => {
      const taskId = Number.parseInt(el.getAttribute('data-id') ?? '0', 10);
      this.toggleTask(taskId);
    });
    this.delegate('click', '.delete-task', (_, el) => {
      const taskId = Number.parseInt(el.getAttribute('data-id') ?? '0', 10);
      this.deleteTask(taskId);
    });
    this.delegate('click', '.filter-btn', (_, el) => {
      const rawFilter = el.getAttribute('data-filter');
      if (isTodoFilter(rawFilter)) {
        this.setFilter(rawFilter);
      }
    });
    this.delegate('click', '#clear-completed-btn', () => this.clearCompleted());

    // Initial paint
    this.renderTasks();
  }

  addTask() {
    const input = this.querySelector('#new-task-input');
    if (!(input instanceof HTMLInputElement)) return;
    const text = input.value.trim();
    if (!text) return;

    this.dispatch({ type: 'add', text });

    // Keep focus in input
    const nextInput = this.querySelector('#new-task-input');
    if (nextInput instanceof HTMLInputElement) {
      nextInput.value = '';
      nextInput.focus();
    }
  }

  toggleTask(id: number) {
    this.dispatch({ type: 'toggle', id });
  }

  deleteTask(id: number) {
    this.dispatch({ type: 'delete', id });
  }

  setFilter(filter: TodoFilter) {
    this.dispatch({ type: 'setFilter', filter });
  }

  clearCompleted() {
    this.dispatch({ type: 'clearCompleted' });
  }

  private renderTasks() {
    const state = this.store.getState();
    const filteredTasks = selectFilteredTasks(state);
    const counts = selectTodoCounts(state);

    this.renderFilterButtons(state.filter);

    const activeCountEl = this.querySelector('[data-active-count]');
    if (activeCountEl) activeCountEl.textContent = String(counts.active);

    this.querySelector('#clear-completed-btn')?.classList.toggle(
      'hidden',
      counts.completed === 0
    );

    this.renderTaskList(filteredTasks);

    const remainingLabelEl = this.querySelector('[data-remaining-label]');
    if (remainingLabelEl) {
      remainingLabelEl.textContent = `${counts.active} active task${counts.active === 1 ? '' : 's'} remaining`;
    }
    const totalCountEl = this.querySelector('[data-total-count]');
    if (totalCountEl) totalCountEl.textContent = String(counts.total);
  }

  private renderFilterButtons(filter: TodoFilter) {
    this.querySelectorAll('.filter-btn').forEach((btn) => {
      const isActive = btn.getAttribute('data-filter') === filter;
      btn.classList.toggle('bg-white', isActive);
      btn.classList.toggle('text-gray-900', isActive);
      btn.classList.toggle('shadow-sm', isActive);
      btn.classList.toggle('text-gray-500', !isActive);
      btn.classList.toggle('hover:text-gray-900', !isActive);
    });
  }

  private renderTaskList(filteredTasks: readonly Task[]) {
    const taskList = this.querySelector('#task-list');
    const emptyState = this.querySelector('#empty-state');
    const itemTemplate = this.querySelector('#task-item-template');
    if (!taskList || !(itemTemplate instanceof HTMLTemplateElement)) return;

    taskList.innerHTML = '';

    if (filteredTasks.length === 0) {
      emptyState?.classList.remove('hidden');
      return;
    }
    emptyState?.classList.add('hidden');

    for (const task of filteredTasks) {
      const fragment = document.importNode(itemTemplate.content, true);

      const toggleEl = fragment.querySelector('.toggle-task');
      const deleteEl = fragment.querySelector('.delete-task');
      const checkboxEl = fragment.querySelector('.checkbox');
      const checkIconEl = fragment.querySelector('.check-icon');
      const textEl = fragment.querySelector('.task-text');
      if (!toggleEl || !deleteEl || !checkboxEl || !checkIconEl || !textEl) {
        continue;
      }

      toggleEl.setAttribute('data-id', String(task.id));
      deleteEl.setAttribute('data-id', String(task.id));
      textEl.textContent = task.text;

      checkboxEl.classList.toggle('bg-green-500', task.completed);
      checkboxEl.classList.toggle('border-green-500', task.completed);
      checkboxEl.classList.toggle('text-white', task.completed);
      checkboxEl.classList.toggle('border-gray-300', !task.completed);
      checkboxEl.classList.toggle(
        'group-hover:border-gray-400',
        !task.completed
      );
      checkIconEl.classList.toggle('hidden', !task.completed);

      textEl.classList.toggle('line-through', task.completed);
      textEl.classList.toggle('text-gray-400', task.completed);
      textEl.classList.toggle('font-normal', task.completed);
      textEl.classList.toggle('text-gray-800', !task.completed);

      taskList.appendChild(fragment);
    }
  }
}

if (!customElements.get(TodoPageComponent.tagName)) {
  customElements.define(TodoPageComponent.tagName, TodoPageComponent);
}
