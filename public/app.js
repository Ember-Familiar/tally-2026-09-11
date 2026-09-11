// Tally Frontend Application
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

function showFeedback(message, type) {
  const feedbackEl = document.getElementById('form-feedback');
  if (!feedbackEl) return;
  feedbackEl.replaceChildren();
  feedbackEl.textContent = message;
  feedbackEl.className = 'feedback-message ' + type;
}

function clearFeedback() {
  const feedbackEl = document.getElementById('form-feedback');
  if (!feedbackEl) return;
  feedbackEl.replaceChildren();
  feedbackEl.className = 'feedback-message hidden';
}

// Render list of groups safely into DOM using only document.createElement and textContent
function renderGroups(groups) {
  const groupsStatusEl = document.getElementById('groups-status-container');
  const groupsListEl = document.getElementById('groups-list');

  if (groupsStatusEl) {
    groupsStatusEl.replaceChildren();
  }
  if (groupsListEl) {
    groupsListEl.replaceChildren();
  }

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

    groupsListEl.appendChild(card);
  });
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

function initApp() {
  const form = document.getElementById('create-group-form');
  const refreshBtn = document.getElementById('refresh-groups-btn');

  if (form) {
    form.addEventListener('submit', handleCreateGroup);
  }
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadGroups();
    });
  }

  loadGroups();
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
    showFeedback,
    clearFeedback,
    renderGroups,
    loadGroups,
    handleCreateGroup,
    initApp,
  };
}
if (typeof window !== 'undefined') {
  window.TallyApp = {
    formatDate,
    showFeedback,
    clearFeedback,
    renderGroups,
    loadGroups,
    handleCreateGroup,
    initApp,
  };
}
