/**
 * Shared typed UI Feature Map for Playwright runtime & visual proofs.
 *
 * Every Boba route, interactive control, and user-visible indicator is defined
 * here once so E2E tests never guess CSS selectors or drift from templates.
 * Extend this map whenever adding a new Boba route or user flow.
 */
export const FeatureMap = {
  shell: {
    routerOutlet: '#router-outlet',
    navComponent: 'app-nav',
    navLinks: '[data-testid="nav-links"]',
    navBrand: '[data-testid="nav-brand"]',
    navTodoLink: '[data-testid="nav-link-todo"]',
    navUsersLink: '[data-testid="nav-link-users"]',
  },
  home: {
    route: '/',
    component: 'home-page',
    heading: '[data-testid="home-heading"]',
    todoCard: '[data-testid="home-todo-card"]',
    usersCard: '[data-testid="home-users-card"]',
  },
  todo: {
    route: '/todo',
    component: 'todo-page',
    input: '[data-testid="todo-input"]',
    addButton: '[data-testid="todo-add-btn"]',
    filterAll: '[data-testid="todo-filter-all"]',
    filterActive: '[data-testid="todo-filter-active"]',
    filterCompleted: '[data-testid="todo-filter-completed"]',
    activeCount: '[data-testid="todo-active-count"]',
    clearCompleted: '[data-testid="todo-clear-completed"]',
    list: '[data-testid="todo-list"]',
    item: '[data-testid="todo-item"]',
    itemToggle: '[data-testid="todo-toggle"]',
    itemText: '[data-testid="todo-text"]',
    itemDelete: '[data-testid="todo-delete"]',
    emptyState: '[data-testid="todo-empty-state"]',
    remainingLabel: '[data-testid="todo-remaining-label"]',
    totalCount: '[data-testid="todo-total-count"]',
  },
  users: {
    route: '/users',
    component: 'users-page',
    form: '[data-testid="users-form"]',
    nameInput: '[data-testid="users-name-input"]',
    roleSelect: '[data-testid="users-role-select"]',
    submitButton: '[data-testid="users-submit-btn"]',
    status: '[data-testid="users-status"]',
    list: '[data-testid="users-list"]',
    item: '[data-testid="users-item"]',
    itemLink: '[data-testid="users-item-link"]',
    itemRole: '[data-testid="users-item-role"]',
  },
  userProfile: {
    routeFor: (name: string) => `/user/${encodeURIComponent(name)}`,
    component: 'user-page',
    nameHeading: '[data-testid="user-profile-name"]',
    backLink: '[data-testid="user-profile-back"]',
  },
  notFound: {
    unknownRoute: '/no/such/page',
    component: 'not-found-page',
    heading: '[data-testid="not-found-heading"]',
    homeLink: '[data-testid="not-found-home-link"]',
  },
} as const;
