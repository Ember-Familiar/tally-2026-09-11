// Tally Frontend Application
let currentGroupId = null;
let loadedGroups = [];

function formatDate(dateString) {
  if (!dateString) return '';
  try {
    // SQLite dates are often formatted as "YYYY-MM-DD HH:MM:SS"
    const normalized = dateString.includes('T') ? dateString : dateString.replace(' ', 'T') + 'Z';
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateString;
  }
}

function formatCents(cents) {
  if (typeof cents !== 'number' || isNaN(cents)) return String(cents ?? '');
  if (cents < 0) {
    const dollars = (Math.abs(cents) / 100).toFixed(2);
    return '-$' + dollars;
  }
  const dollars = (cents / 100).toFixed(2);
  return '$' + dollars;
}

function getGroupMembers(groupId) {
  const parsedId = Number(groupId);
  if (isNaN(parsedId)) return [];

  if (Array.isArray(loadedGroups)) {
    const group = loadedGroups.find((g) => Number(g.id) === parsedId);
    if (group && Array.isArray(group.members)) {
      return group.members;
    }
  }

  if (typeof document !== 'undefined') {
    const card = document.querySelector(`.group-card[data-group-id="${parsedId}"]`);
    if (card) {
      const badges = card.querySelectorAll('.member-badge');
      if (badges && badges.length > 0) {
        return Array.from(badges).map((b) => ({ name: (b.textContent || '').trim() }));
      }
    }
  }

  return [];
}

function showFeedback(message, type, elementId = 'form-feedback') {
  const feedbackEl = document.getElementById(elementId);
  if (!feedbackEl) return;
  feedbackEl.replaceChildren();
  feedbackEl.textContent = message;
  feedbackEl.className = 'feedback-message ' + type;
}

function clearFeedback(elementId = 'form-feedback') {
  const feedbackEl = document.getElementById(elementId);
  if (!feedbackEl) return;
  feedbackEl.replaceChildren();
  feedbackEl.className = 'feedback-message hidden';
}

function showExpenseFeedback(message, type) {
  showFeedback(message, type, 'expense-feedback');
}

function clearExpenseFeedback() {
  clearFeedback('expense-feedback');
}

function showSettleFeedback(message, type) {
  showFeedback(message, type, 'settle-feedback');
}

function clearSettleFeedback() {
  clearFeedback('settle-feedback');
}

function updateGroupSelector(groups) {
  const groupSelect = document.getElementById('expense-group') || document.getElementById('expense-group-id');
  if (!groupSelect) return;

  const currentVal = groupSelect.value;
  groupSelect.replaceChildren();

  if (!Array.isArray(groups) || groups.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- No groups available --';
    groupSelect.appendChild(opt);
    return;
  }

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '-- Select a group --';
  groupSelect.appendChild(defaultOpt);

  let matchFound = false;
  groups.forEach((g) => {
    const opt = document.createElement('option');
    opt.value = String(g.id);
    opt.textContent = g.name;
    if (currentVal && String(g.id) === String(currentVal)) {
      opt.selected = true;
      matchFound = true;
    } else if (currentGroupId && g.id === currentGroupId) {
      opt.selected = true;
      matchFound = true;
    }
    groupSelect.appendChild(opt);
  });

  if (currentVal && !matchFound && !currentGroupId) {
    groupSelect.value = '';
  }
}

// Render list of groups safely into DOM using only document.createElement and textContent
function renderGroups(groups) {
  if (Array.isArray(groups)) {
    loadedGroups = groups;
  } else {
    loadedGroups = [];
  }

  const groupsStatusEl = document.getElementById('groups-status-container');
  const groupsListEl = document.getElementById('groups-list');

  if (groupsStatusEl) {
    groupsStatusEl.replaceChildren();
  }
  if (groupsListEl) {
    groupsListEl.replaceChildren();
  }

  // Update group selector dropdown
  updateGroupSelector(groups);

  if (!Array.isArray(groups) || groups.length === 0) {
    if (groupsStatusEl) {
      const emptyContainer = document.createElement('div');
      emptyContainer.className = 'state-container';

      const icon = document.createElement('div');
      icon.className = 'state-icon';
      icon.textContent = '👥';

      const title = document.createElement('div');
      title.className = 'state-title';
      title.textContent = 'No groups yet';

      const text = document.createElement('div');
      text.className = 'state-text';
      text.textContent = 'Create your first expense group above to get started!';

      emptyContainer.appendChild(icon);
      emptyContainer.appendChild(title);
      emptyContainer.appendChild(text);

      groupsStatusEl.appendChild(emptyContainer);
    }
    return;
  }

  if (!groupsListEl) return;

  groups.forEach((group) => {
    const card = document.createElement('div');
    card.className = 'group-card';
    if (currentGroupId && group.id === currentGroupId) {
      card.className = 'group-card active';
    }
    card.setAttribute('data-group-id', String(group.id));

    // Header: Name & Date
    const header = document.createElement('div');
    header.className = 'group-card-header';

    const nameEl = document.createElement('h3');
    nameEl.className = 'group-name';
    nameEl.textContent = group.name;

    const dateEl = document.createElement('span');
    dateEl.className = 'group-date';
    dateEl.textContent = formatDate(group.created_at);

    header.appendChild(nameEl);
    header.appendChild(dateEl);
    card.appendChild(header);

    // Members section
    const membersContainer = document.createElement('div');
    membersContainer.className = 'group-members-container';

    const membersList = Array.isArray(group.members) ? group.members : [];
    const label = document.createElement('div');
    label.className = 'group-members-label';
    label.textContent = `Members (${membersList.length})`;
    membersContainer.appendChild(label);

    const badgesContainer = document.createElement('div');
    badgesContainer.className = 'member-badges';

    membersList.forEach((member) => {
      const badge = document.createElement('span');
      badge.className = 'member-badge';
      badge.textContent = typeof member === 'object' && member !== null ? member.name : String(member);
      badgesContainer.appendChild(badge);
    });

    membersContainer.appendChild(badgesContainer);
    card.appendChild(membersContainer);

    // Actions
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'group-card-actions';

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'btn btn-secondary btn-sm select-group-btn';
    selectBtn.setAttribute('data-group-id', String(group.id));
    selectBtn.textContent = 'View Expenses';
    selectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectGroup(group.id);
    });

    actionsDiv.appendChild(selectBtn);
    card.appendChild(actionsDiv);

    card.addEventListener('click', () => {
      selectGroup(group.id);
    });

    groupsListEl.appendChild(card);
  });
}

// Select an active group
function selectGroup(groupId) {
  const parsedId = Number(groupId);
  if (isNaN(parsedId) || parsedId <= 0) return;
  currentGroupId = parsedId;

  const groupSelect = document.getElementById('expense-group') || document.getElementById('expense-group-id');
  if (groupSelect) {
    groupSelect.value = String(parsedId);
  }

  const allCards = document.querySelectorAll('.group-card');
  allCards.forEach((c) => {
    if (c.getAttribute('data-group-id') === String(parsedId)) {
      c.classList.add('active');
    } else {
      c.classList.remove('active');
    }
  });

  const expensesSubtitle = document.getElementById('expenses-subtitle');
  if (expensesSubtitle) {
    expensesSubtitle.textContent = `Viewing expenses for group #${parsedId}.`;
  }

  const balancesSubtitle = document.getElementById('balances-subtitle');
  if (balancesSubtitle) {
    balancesSubtitle.textContent = `Viewing balances for group #${parsedId}.`;
  }

  loadExpenses(parsedId);
  loadBalances(parsedId);
}

// Load groups from GET /groups API
async function loadGroups() {
  const groupsStatusEl = document.getElementById('groups-status-container');
  if (groupsStatusEl) {
    groupsStatusEl.replaceChildren();
    const loadingContainer = document.createElement('div');
    loadingContainer.className = 'state-container';

    const text = document.createElement('div');
    text.className = 'state-text';
    text.textContent = 'Loading groups...';
    loadingContainer.appendChild(text);
    groupsStatusEl.appendChild(loadingContainer);
  }

  try {
    const response = await fetch('/groups', {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      if (response.status >= 500) {
        throw new Error('Server error occurred. Please try again later.');
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to load groups (HTTP ${response.status})`);
    }

    const groups = await response.json();
    renderGroups(groups);
  } catch (err) {
    if (groupsStatusEl) {
      groupsStatusEl.replaceChildren();
      const errContainer = document.createElement('div');
      errContainer.className = 'state-container';

      const icon = document.createElement('div');
      icon.className = 'state-icon';
      icon.textContent = '⚠️';

      const title = document.createElement('div');
      title.className = 'state-title';
      title.textContent = 'Unable to load groups';

      const textEl = document.createElement('div');
      textEl.className = 'state-text';
      textEl.textContent = err.message || 'Network error occurred. Please try again.';

      errContainer.appendChild(icon);
      errContainer.appendChild(title);
      errContainer.appendChild(textEl);
      groupsStatusEl.appendChild(errContainer);
    }
  }
}

// Handle Form Submit to Create Group
async function handleCreateGroup(e) {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  clearFeedback();

  const form = document.getElementById('create-group-form');
  const nameInput = document.getElementById('group-name');
  const membersInput = document.getElementById('group-members');
  const submitBtn = document.getElementById('create-group-btn');

  const rawName = nameInput ? nameInput.value : '';
  const rawMembers = membersInput ? membersInput.value : '';

  const members = rawMembers
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const payload = {
    name: rawName,
    members,
  };

  let btnTextEl = null;
  let originalBtnText = 'Create Group';
  if (submitBtn) {
    submitBtn.disabled = true;
    btnTextEl = submitBtn.querySelector('.btn-text');
    if (btnTextEl) {
      originalBtnText = btnTextEl.textContent;
      btnTextEl.textContent = 'Creating...';
    }
  }

  try {
    const response = await fetch('/groups', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status >= 500) {
        throw new Error('Server error occurred. Please try again later.');
      }
      throw new Error(data.error || `Error creating group (HTTP ${response.status})`);
    }

    showFeedback(`Group "${data.name}" created successfully!`, 'success');
    if (form && typeof form.reset === 'function') {
      form.reset();
    }

    // Refresh groups list
    await loadGroups();
  } catch (err) {
    showFeedback(err.message || 'Failed to create group. Please check input and try again.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      if (btnTextEl) {
        btnTextEl.textContent = originalBtnText;
      }
    }
  }
}

// Render list of expenses safely into DOM using only document.createElement and textContent
function renderExpenses(expenses) {
  const expensesStatusEl = document.getElementById('expenses-status-container');
  const expensesListEl = document.getElementById('expenses-list');

  if (expensesStatusEl) {
    expensesStatusEl.replaceChildren();
  }
  if (expensesListEl) {
    expensesListEl.replaceChildren();
  }

  if (!Array.isArray(expenses) || expenses.length === 0) {
    if (expensesStatusEl) {
      const emptyContainer = document.createElement('div');
      emptyContainer.className = 'state-container';

      const icon = document.createElement('div');
      icon.className = 'state-icon';
      icon.textContent = '💸';

      const title = document.createElement('div');
      title.className = 'state-title';
      title.textContent = 'No expenses yet';

      const text = document.createElement('div');
      text.className = 'state-text';
      text.textContent = 'Add your first expense above to start splitting costs!';

      emptyContainer.appendChild(icon);
      emptyContainer.appendChild(title);
      emptyContainer.appendChild(text);

      expensesStatusEl.appendChild(emptyContainer);
    }
    return;
  }

  if (!expensesListEl) return;

  expenses.forEach((expense) => {
    const card = document.createElement('div');
    card.className = 'expense-card';
    card.setAttribute('data-expense-id', String(expense.id));
    card.setAttribute('data-amount', String(expense.amount));

    // Header: Description & Amount
    const header = document.createElement('div');
    header.className = 'expense-card-header';

    const descEl = document.createElement('h4');
    descEl.className = 'expense-description';
    descEl.textContent = expense.description || '(No description)';

    const amountEl = document.createElement('span');
    amountEl.className = 'expense-amount';
    amountEl.textContent = formatCents(expense.amount);

    header.appendChild(descEl);
    header.appendChild(amountEl);
    card.appendChild(header);

    // Meta details: Payer & Date
    const meta = document.createElement('div');
    meta.className = 'expense-meta';

    let payerName = 'User #' + expense.paid_by;
    if (Array.isArray(expense.splits)) {
      const payerSplit = expense.splits.find((s) => s.user_id === expense.paid_by);
      if (payerSplit && payerSplit.user_name) {
        payerName = payerSplit.user_name;
      }
    }
    if (payerName === 'User #' + expense.paid_by) {
      const groupMembers = getGroupMembers(expense.group_id);
      const member = groupMembers.find((m) => typeof m === 'object' && m !== null && Number(m.id) === Number(expense.paid_by));
      if (member && member.name) {
        payerName = member.name;
      }
    }

    const payerEl = document.createElement('span');
    payerEl.className = 'expense-payer';
    payerEl.textContent = 'Paid by ' + payerName;

    const dateEl = document.createElement('span');
    dateEl.className = 'expense-date';
    dateEl.textContent = formatDate(expense.date);

    meta.appendChild(payerEl);
    meta.appendChild(dateEl);
    card.appendChild(meta);

    // Splits breakdown
    if (Array.isArray(expense.splits) && expense.splits.length > 0) {
      const splitsContainer = document.createElement('div');
      splitsContainer.className = 'expense-splits-container';

      const splitsLabel = document.createElement('div');
      splitsLabel.className = 'expense-splits-label';
      splitsLabel.textContent = `Splits (${expense.splits.length})`;
      splitsContainer.appendChild(splitsLabel);

      const badgesContainer = document.createElement('div');
      badgesContainer.className = 'member-badges';

      expense.splits.forEach((split) => {
        const badge = document.createElement('span');
        badge.className = 'member-badge';
        badge.textContent = split.user_name + ': ' + formatCents(split.amount);
        badgesContainer.appendChild(badge);
      });

      splitsContainer.appendChild(badgesContainer);
      card.appendChild(splitsContainer);
    }

    expensesListEl.appendChild(card);
  });
}

// Load expenses from GET /groups/:id/expenses API
async function loadExpenses(groupId) {
  const expensesStatusEl = document.getElementById('expenses-status-container');
  const expensesListEl = document.getElementById('expenses-list');

  if (expensesListEl) {
    expensesListEl.replaceChildren();
  }

  if (!groupId) {
    if (expensesStatusEl) {
      expensesStatusEl.replaceChildren();
      const emptyContainer = document.createElement('div');
      emptyContainer.className = 'state-container';

      const icon = document.createElement('div');
      icon.className = 'state-icon';
      icon.textContent = '📋';

      const title = document.createElement('div');
      title.className = 'state-title';
      title.textContent = 'No group selected';

      const text = document.createElement('div');
      text.className = 'state-text';
      text.textContent = 'Select a group above to view and add expenses.';

      emptyContainer.appendChild(icon);
      emptyContainer.appendChild(title);
      emptyContainer.appendChild(text);

      expensesStatusEl.appendChild(emptyContainer);
    }
    return;
  }

  if (expensesStatusEl) {
    expensesStatusEl.replaceChildren();
    const loadingContainer = document.createElement('div');
    loadingContainer.className = 'state-container';

    const text = document.createElement('div');
    text.className = 'state-text';
    text.textContent = 'Loading expenses...';
    loadingContainer.appendChild(text);
    expensesStatusEl.appendChild(loadingContainer);
  }

  try {
    const response = await fetch('/groups/' + groupId + '/expenses', {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      if (response.status >= 500) {
        throw new Error('Server error occurred. Please try again later.');
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to load expenses (HTTP ${response.status})`);
    }

    const expenses = await response.json();
    renderExpenses(expenses);
  } catch (err) {
    if (expensesStatusEl) {
      expensesStatusEl.replaceChildren();
      const errContainer = document.createElement('div');
      errContainer.className = 'state-container';

      const icon = document.createElement('div');
      icon.className = 'state-icon';
      icon.textContent = '⚠️';

      const title = document.createElement('div');
      title.className = 'state-title';
      title.textContent = 'Unable to load expenses';

      const textEl = document.createElement('div');
      textEl.className = 'state-text';
      textEl.textContent = err.message || 'Network error occurred. Please try again.';

      errContainer.appendChild(icon);
      errContainer.appendChild(title);
      errContainer.appendChild(textEl);
      expensesStatusEl.appendChild(errContainer);
    }
  }
}

// Handle Form Submit to Add Expense
async function handleCreateExpense(e, explicitGroupId) {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  clearExpenseFeedback();

  const form = document.getElementById('add-expense-form');
  const groupSelect = document.getElementById('expense-group') || document.getElementById('expense-group-id');
  const descInput = document.getElementById('expense-description') || document.getElementById('expense-desc');
  const amountInput = document.getElementById('expense-amount');
  const payerInput = document.getElementById('expense-payer') || document.getElementById('expense-paid-by');
  const dateInput = document.getElementById('expense-date');
  const submitBtn = document.getElementById('add-expense-btn') || document.getElementById('create-expense-btn');

  let groupId = explicitGroupId;
  if (!groupId && (typeof e === 'number' || (typeof e === 'string' && /^[1-9]\d*$/.test(e)))) {
    groupId = Number(e);
  }
  if (!groupId && groupSelect && groupSelect.value) {
    const parsed = Number(groupSelect.value);
    if (!isNaN(parsed) && parsed > 0) {
      groupId = parsed;
    }
  }
  if (!groupId && currentGroupId) {
    groupId = currentGroupId;
  }

  if (!groupId) {
    showExpenseFeedback('Please select a group first.', 'error');
    return;
  }

  const rawDesc = descInput ? descInput.value : '';
  const rawAmountStr = amountInput ? amountInput.value.trim() : '';
  const rawPayer = payerInput ? payerInput.value.trim() : '';
  const rawDate = dateInput ? dateInput.value.trim() : '';

  const payload = {};
  if (rawDesc !== '') {
    payload.description = rawDesc;
  }
  if (rawAmountStr !== '') {
    const num = Number(rawAmountStr);
    payload.amount = isNaN(num) ? rawAmountStr : num;
  }
  if (rawPayer !== '') {
    const groupMembers = getGroupMembers(groupId);
    const matchesMemberName = groupMembers.some((m) => {
      const name = typeof m === 'object' && m !== null ? m.name : String(m);
      return name.trim() === rawPayer;
    });

    if (matchesMemberName) {
      payload.paid_by = rawPayer;
    } else if (/^[1-9]\d*$/.test(rawPayer)) {
      payload.paid_by = Number(rawPayer);
    } else {
      payload.paid_by = rawPayer;
    }
  }
  if (rawDate !== '') {
    payload.date = rawDate;
  }

  let btnTextEl = null;
  let originalBtnText = 'Add Expense';
  if (submitBtn) {
    submitBtn.disabled = true;
    btnTextEl = submitBtn.querySelector('.btn-text');
    if (btnTextEl) {
      originalBtnText = btnTextEl.textContent;
      btnTextEl.textContent = 'Adding...';
    }
  }

  try {
    const response = await fetch('/groups/' + groupId + '/expenses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status >= 500) {
        throw new Error('Server error occurred. Please try again later.');
      }
      throw new Error(data.error || `Error adding expense (HTTP ${response.status})`);
    }

    const descText = data.description ? ` "${data.description}"` : '';
    showExpenseFeedback(`Expense${descText} added successfully!`, 'success');

    if (form && typeof form.reset === 'function') {
      const savedGroupId = groupId;
      form.reset();
      if (groupSelect) {
        groupSelect.value = String(savedGroupId);
      }
    }

    // Refresh expenses list and balances
    await loadExpenses(groupId);
    await loadBalances(groupId);
  } catch (err) {
    showExpenseFeedback(err.message || 'Failed to add expense. Please check input and try again.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      if (btnTextEl) {
        btnTextEl.textContent = originalBtnText;
      }
    }
  }
}

// Render group balance summary and settlement suggestions safely into DOM
function renderBalances(balancesData) {
  const balancesStatusEl = document.getElementById('balances-status-container');
  const balancesContentEl = document.getElementById('balances-content');
  const memberBalancesListEl = document.getElementById('member-balances-list');
  const settlementsStatusEl = document.getElementById('settlements-status-container');
  const settlementsListEl = document.getElementById('settlements-list');

  if (balancesStatusEl) {
    balancesStatusEl.replaceChildren();
  }
  if (memberBalancesListEl) {
    memberBalancesListEl.replaceChildren();
  }
  if (settlementsStatusEl) {
    settlementsStatusEl.replaceChildren();
  }
  if (settlementsListEl) {
    settlementsListEl.replaceChildren();
  }

  if (!balancesData || typeof balancesData !== 'object') {
    if (balancesStatusEl) {
      const emptyContainer = document.createElement('div');
      emptyContainer.className = 'state-container';

      const icon = document.createElement('div');
      icon.className = 'state-icon';
      icon.textContent = '⚖️';

      const title = document.createElement('div');
      title.className = 'state-title';
      title.textContent = 'No balance data';

      const text = document.createElement('div');
      text.className = 'state-text';
      text.textContent = 'Balance summary could not be found for this group.';

      emptyContainer.appendChild(icon);
      emptyContainer.appendChild(title);
      emptyContainer.appendChild(text);

      balancesStatusEl.appendChild(emptyContainer);
    }
    return;
  }

  if (balancesContentEl) {
    balancesContentEl.classList.remove('hidden');
  }

  // 1. Member Balances
  const balancesList = Array.isArray(balancesData.balances) ? balancesData.balances : [];
  if (memberBalancesListEl) {
    if (balancesList.length === 0) {
      const emptyCard = document.createElement('div');
      emptyCard.className = 'state-container';
      const text = document.createElement('div');
      text.className = 'state-text';
      text.textContent = 'No members in this group.';
      emptyCard.appendChild(text);
      memberBalancesListEl.appendChild(emptyCard);
    } else {
      balancesList.forEach((b) => {
        const card = document.createElement('div');
        card.className = 'balance-card';
        const userId = b.user_id !== undefined ? b.user_id : b.userId;
        if (userId !== undefined) {
          card.setAttribute('data-user-id', String(userId));
        }
        const net = typeof b.net_balance === 'number' ? b.net_balance : (typeof b.balance === 'number' ? b.balance : 0);
        card.setAttribute('data-net-balance', String(net));

        // Header: Member Name & Net Balance
        const header = document.createElement('div');
        header.className = 'balance-card-header';

        const nameEl = document.createElement('h4');
        nameEl.className = 'member-name';
        nameEl.textContent = b.name || ('User #' + userId);

        const netEl = document.createElement('span');
        netEl.className = 'net-balance-amount';
        if (net > 0) {
          netEl.classList.add('positive');
          netEl.textContent = '+' + formatCents(net);
        } else if (net < 0) {
          netEl.classList.add('negative');
          netEl.textContent = formatCents(net);
        } else {
          netEl.classList.add('zero');
          netEl.textContent = formatCents(0);
        }

        header.appendChild(nameEl);
        header.appendChild(netEl);
        card.appendChild(header);

        // Details: Status Tag & Spend/Owed Breakdown
        const details = document.createElement('div');
        details.className = 'balance-details';

        const statusTag = document.createElement('span');
        statusTag.className = 'balance-status-tag';
        if (net > 0) {
          statusTag.classList.add('tag-positive');
          statusTag.textContent = 'Gets back ' + formatCents(net);
        } else if (net < 0) {
          statusTag.classList.add('tag-negative');
          statusTag.textContent = 'Owes ' + formatCents(Math.abs(net));
        } else {
          statusTag.classList.add('tag-settled');
          statusTag.textContent = 'Settled up';
        }

        const spendInfo = document.createElement('span');
        spendInfo.className = 'balance-spend-info';
        const paidCents = typeof b.paid === 'number' ? b.paid : 0;
        const owedCents = typeof b.owed === 'number' ? b.owed : 0;
        spendInfo.textContent = 'Paid ' + formatCents(paidCents) + ' • Owed ' + formatCents(owedCents);

        details.appendChild(statusTag);
        details.appendChild(spendInfo);
        card.appendChild(details);

        memberBalancesListEl.appendChild(card);
      });
    }
  }

  // 2. Settlement Suggestions
  const settlements = Array.isArray(balancesData.settlements) ? balancesData.settlements : [];
  if (settlements.length === 0) {
    if (settlementsStatusEl) {
      const settledContainer = document.createElement('div');
      settledContainer.className = 'state-container settled-state';

      const icon = document.createElement('div');
      icon.className = 'state-icon';
      icon.textContent = '🎉';

      const title = document.createElement('div');
      title.className = 'state-title';
      title.textContent = 'All settled up!';

      const text = document.createElement('div');
      text.className = 'state-text';
      text.textContent = 'No outstanding debts between group members.';

      settledContainer.appendChild(icon);
      settledContainer.appendChild(title);
      settledContainer.appendChild(text);

      settlementsStatusEl.appendChild(settledContainer);
    }
  } else if (settlementsListEl) {
    settlements.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'settlement-card';
      const fromId = s.from !== undefined ? s.from : s.from_user_id;
      const toId = s.to !== undefined ? s.to : s.to_user_id;
      if (fromId !== undefined) card.setAttribute('data-from', String(fromId));
      if (toId !== undefined) card.setAttribute('data-to', String(toId));
      card.setAttribute('data-amount', String(s.amount));

      const info = document.createElement('div');
      info.className = 'settlement-info';

      const fromName = s.from_name || ('User #' + fromId);
      const toName = s.to_name || ('User #' + toId);
      const amountStr = formatCents(s.amount);

      const instruction = document.createElement('span');
      instruction.className = 'settlement-instruction';

      const fromBold = document.createElement('strong');
      fromBold.className = 'settlement-from';
      fromBold.textContent = fromName;

      const owesText = document.createTextNode(' owes ');

      const toBold = document.createElement('strong');
      toBold.className = 'settlement-to';
      toBold.textContent = toName;

      const colonText = document.createTextNode(': ');

      const amountBold = document.createElement('strong');
      amountBold.className = 'settlement-amount';
      amountBold.textContent = amountStr;

      instruction.appendChild(fromBold);
      instruction.appendChild(owesText);
      instruction.appendChild(toBold);
      instruction.appendChild(colonText);
      instruction.appendChild(amountBold);

      info.appendChild(instruction);
      card.appendChild(info);

      // Action button: Settle Up
      const actionDiv = document.createElement('div');
      actionDiv.className = 'settlement-action';

      const settleBtn = document.createElement('button');
      settleBtn.type = 'button';
      settleBtn.className = 'btn btn-secondary btn-sm settle-btn';
      settleBtn.textContent = 'Settle Up';
      settleBtn.setAttribute('data-from', fromName);
      settleBtn.setAttribute('data-to', toName);
      settleBtn.setAttribute('data-amount', String(s.amount));

      settleBtn.addEventListener('click', () => {
        const payerInput = document.getElementById('settle-payer') || document.getElementById('settle-from');
        const payeeInput = document.getElementById('settle-payee') || document.getElementById('settle-to');
        const amountInput = document.getElementById('settle-amount');
        const descInput = document.getElementById('settle-description') || document.getElementById('settle-desc');
        const form = document.getElementById('settle-up-form') || document.getElementById('settle-form');

        if (payerInput) payerInput.value = fromName;
        if (payeeInput) payeeInput.value = toName;
        if (amountInput) amountInput.value = String(s.amount);
        if (descInput) descInput.value = 'Settlement to ' + toName;

        if (form && typeof form.scrollIntoView === 'function') {
          form.scrollIntoView({ behavior: 'smooth' });
        }
        if (amountInput && typeof amountInput.focus === 'function') {
          amountInput.focus();
        }
      });

      actionDiv.appendChild(settleBtn);
      card.appendChild(actionDiv);

      settlementsListEl.appendChild(card);
    });
  }
}

// Load balances from GET /groups/:id/balances API
async function loadBalances(groupId) {
  const balancesStatusEl = document.getElementById('balances-status-container');
  const balancesContentEl = document.getElementById('balances-content');
  const memberBalancesListEl = document.getElementById('member-balances-list');
  const settlementsListEl = document.getElementById('settlements-list');
  const settlementsStatusEl = document.getElementById('settlements-status-container');

  if (memberBalancesListEl) {
    memberBalancesListEl.replaceChildren();
  }
  if (settlementsListEl) {
    settlementsListEl.replaceChildren();
  }
  if (settlementsStatusEl) {
    settlementsStatusEl.replaceChildren();
  }

  if (!groupId) {
    if (balancesStatusEl) {
      balancesStatusEl.replaceChildren();
      const emptyContainer = document.createElement('div');
      emptyContainer.className = 'state-container';

      const icon = document.createElement('div');
      icon.className = 'state-icon';
      icon.textContent = '⚖️';

      const title = document.createElement('div');
      title.className = 'state-title';
      title.textContent = 'No group selected';

      const text = document.createElement('div');
      text.className = 'state-text';
      text.textContent = 'Select a group above to view member balances and settlement suggestions.';

      emptyContainer.appendChild(icon);
      emptyContainer.appendChild(title);
      emptyContainer.appendChild(text);

      balancesStatusEl.appendChild(emptyContainer);
    }
    if (balancesContentEl) {
      balancesContentEl.classList.add('hidden');
    }
    return;
  }

  if (balancesStatusEl) {
    balancesStatusEl.replaceChildren();
    const loadingContainer = document.createElement('div');
    loadingContainer.className = 'state-container';

    const text = document.createElement('div');
    text.className = 'state-text';
    text.textContent = 'Loading balances...';
    loadingContainer.appendChild(text);
    balancesStatusEl.appendChild(loadingContainer);
  }

  try {
    const response = await fetch('/groups/' + groupId + '/balances', {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      if (response.status >= 500) {
        throw new Error('Server error occurred. Please try again later.');
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to load balances (HTTP ${response.status})`);
    }

    const balancesData = await response.json();
    renderBalances(balancesData);
  } catch (err) {
    if (balancesStatusEl) {
      balancesStatusEl.replaceChildren();
      const errContainer = document.createElement('div');
      errContainer.className = 'state-container';

      const icon = document.createElement('div');
      icon.className = 'state-icon';
      icon.textContent = '⚠️';

      const title = document.createElement('div');
      title.className = 'state-title';
      title.textContent = 'Unable to load balances';

      const textEl = document.createElement('div');
      textEl.className = 'state-text';
      textEl.textContent = err.message || 'Network error occurred. Please try again.';

      errContainer.appendChild(icon);
      errContainer.appendChild(title);
      errContainer.appendChild(textEl);
      balancesStatusEl.appendChild(errContainer);
    }
    if (balancesContentEl) {
      balancesContentEl.classList.add('hidden');
    }
  }
}

// Handle Form Submit to Record Settlement
async function handleSettleUp(e, explicitGroupId) {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  clearSettleFeedback();

  const form = document.getElementById('settle-up-form') || document.getElementById('settle-form');
  const groupSelect = document.getElementById('expense-group') || document.getElementById('expense-group-id');
  const payerInput = document.getElementById('settle-payer') || document.getElementById('settle-from');
  const payeeInput = document.getElementById('settle-payee') || document.getElementById('settle-to');
  const amountInput = document.getElementById('settle-amount');
  const dateInput = document.getElementById('settle-date');
  const descInput = document.getElementById('settle-description') || document.getElementById('settle-desc');
  const submitBtn = document.getElementById('settle-btn') || document.getElementById('settle-up-btn');

  let groupId = explicitGroupId;
  if (!groupId && (typeof e === 'number' || (typeof e === 'string' && /^[1-9]\d*$/.test(e)))) {
    groupId = Number(e);
  }
  if (!groupId && groupSelect && groupSelect.value) {
    const parsed = Number(groupSelect.value);
    if (!isNaN(parsed) && parsed > 0) {
      groupId = parsed;
    }
  }
  if (!groupId && currentGroupId) {
    groupId = currentGroupId;
  }

  if (!groupId) {
    showSettleFeedback('Please select a group first.', 'error');
    return;
  }

  const rawPayer = payerInput ? payerInput.value.trim() : '';
  const rawPayee = payeeInput ? payeeInput.value.trim() : '';
  const rawAmountStr = amountInput ? amountInput.value.trim() : '';
  const rawDate = dateInput ? dateInput.value.trim() : '';
  const rawDesc = descInput ? descInput.value.trim() : '';

  const groupMembers = getGroupMembers(groupId);
  function resolveParticipant(val) {
    if (!val) return '';
    const matchesName = groupMembers.some((m) => {
      const name = typeof m === 'object' && m !== null ? m.name : String(m);
      return name.trim().toLowerCase() === val.toLowerCase();
    });
    if (matchesName) {
      return val;
    } else if (/^[1-9]\d*$/.test(val)) {
      return Number(val);
    }
    return val;
  }

  const payload = {};
  if (rawPayer !== '') {
    payload.from = resolveParticipant(rawPayer);
  }
  if (rawPayee !== '') {
    payload.to = resolveParticipant(rawPayee);
  }
  if (rawAmountStr !== '') {
    const num = Number(rawAmountStr);
    payload.amount = isNaN(num) ? rawAmountStr : num;
  }
  if (rawDate !== '') {
    payload.date = rawDate;
  }
  if (rawDesc !== '') {
    payload.description = rawDesc;
  }

  let btnTextEl = null;
  let originalBtnText = 'Record Settlement';
  if (submitBtn) {
    submitBtn.disabled = true;
    btnTextEl = submitBtn.querySelector('.btn-text');
    if (btnTextEl) {
      originalBtnText = btnTextEl.textContent;
      btnTextEl.textContent = 'Recording...';
    }
  }

  try {
    const response = await fetch('/groups/' + groupId + '/settle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status >= 500) {
        throw new Error('Server error occurred. Please try again later.');
      }
      throw new Error(data.error || `Error recording settlement (HTTP ${response.status})`);
    }

    const fromName = data.from_name || ('User #' + (data.from || data.from_user_id));
    const toName = data.to_name || ('User #' + (data.to || data.to_user_id));
    const formatted = formatCents(data.amount);
    showSettleFeedback(`Settlement of ${formatted} from ${fromName} to ${toName} recorded successfully!`, 'success');

    if (form && typeof form.reset === 'function') {
      form.reset();
    }

    // Refresh balances view
    await loadBalances(groupId);
  } catch (err) {
    showSettleFeedback(err.message || 'Failed to record settlement. Please check input and try again.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      if (btnTextEl) {
        btnTextEl.textContent = originalBtnText;
      }
    }
  }
}

function initApp() {
  const groupForm = document.getElementById('create-group-form');
  const refreshGroupsBtn = document.getElementById('refresh-groups-btn');

  const expenseForm = document.getElementById('add-expense-form');
  const refreshExpensesBtn = document.getElementById('refresh-expenses-btn');
  const groupSelect = document.getElementById('expense-group') || document.getElementById('expense-group-id');

  const settleForm = document.getElementById('settle-up-form') || document.getElementById('settle-form');
  const refreshBalancesBtn = document.getElementById('refresh-balances-btn');

  if (groupForm) {
    groupForm.addEventListener('submit', handleCreateGroup);
  }
  if (refreshGroupsBtn) {
    refreshGroupsBtn.addEventListener('click', () => {
      loadGroups();
    });
  }

  if (expenseForm) {
    expenseForm.addEventListener('submit', handleCreateExpense);
  }
  if (refreshExpensesBtn) {
    refreshExpensesBtn.addEventListener('click', () => {
      let gid = currentGroupId;
      if (!gid && groupSelect && groupSelect.value) {
        gid = Number(groupSelect.value);
      }
      if (gid) {
        loadExpenses(gid);
      }
    });
  }
  if (groupSelect) {
    groupSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val) {
        selectGroup(Number(val));
      } else {
        currentGroupId = null;
        loadExpenses(null);
        loadBalances(null);
      }
    });
  }

  if (settleForm) {
    settleForm.addEventListener('submit', handleSettleUp);
  }
  if (refreshBalancesBtn) {
    refreshBalancesBtn.addEventListener('click', () => {
      let gid = currentGroupId;
      if (!gid && groupSelect && groupSelect.value) {
        gid = Number(groupSelect.value);
      }
      if (gid) {
        loadBalances(gid);
      }
    });
  }

  loadGroups();
  loadExpenses(null);
  loadBalances(null);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatDate,
    formatCents,
    showFeedback,
    clearFeedback,
    showExpenseFeedback,
    clearExpenseFeedback,
    showSettleFeedback,
    clearSettleFeedback,
    renderGroups,
    loadGroups,
    handleCreateGroup,
    renderExpenses,
    loadExpenses,
    handleCreateExpense,
    renderBalances,
    loadBalances,
    handleSettleUp,
    selectGroup,
    initApp,
  };
}
if (typeof window !== 'undefined') {
  window.TallyApp = {
    formatDate,
    formatCents,
    showFeedback,
    clearFeedback,
    showExpenseFeedback,
    clearExpenseFeedback,
    showSettleFeedback,
    clearSettleFeedback,
    renderGroups,
    loadGroups,
    handleCreateGroup,
    renderExpenses,
    loadExpenses,
    handleCreateExpense,
    renderBalances,
    loadBalances,
    handleSettleUp,
    selectGroup,
    initApp,
  };
}
