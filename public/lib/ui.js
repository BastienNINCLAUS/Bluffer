import { h } from './dom.js';
import { avatarSpec, membersOf, teamLabel } from './model.js';

// Rond à bordure de la couleur d'équipe, photo (ou initiales) au centre.
export function avatar(player, color, code, size = 'md') {
  const spec = avatarSpec(player, color, code);
  return h(
    'span',
    { class: `avatar avatar-${size}`, vars: { '--team': spec.color }, title: spec.name },
    spec.src
      ? h('img', { src: spec.src, alt: spec.name, loading: 'lazy', draggable: false })
      : h('span', { class: 'avatar-initials' }, spec.initials),
  );
}

export function avatarStack(view, team, size = 'sm') {
  return h(
    'span',
    { class: 'avatar-stack' },
    membersOf(view, team).map((member) => avatar(member, team.color, view.code, size)),
  );
}

export function teamChip(view, team, { size = 'sm', extra = null } = {}) {
  return h(
    'span',
    { class: 'team-chip', vars: { '--team': team.color } },
    avatarStack(view, team, size),
    h('span', { class: 'team-chip-name' }, teamLabel(team)),
    extra,
  );
}

let toastTimer = null;
export function toast(message, kind = 'error') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.className = `toast toast-${kind} visible`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
}
