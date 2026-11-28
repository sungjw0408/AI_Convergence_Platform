const shapes = {
  tent: '<path d="m3 21 9-17 9 17H3Zm5 0 4-8 4 8M10 2l3 5m1-5-3 5"/>',
  camera: '<path d="m8 6 2-3h4l2 3h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4Z"/><circle cx="12" cy="13" r="4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  tool: '<path d="M14 6a5 5 0 0 0-6 6L3 17a2.8 2.8 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-4-4 3-3Z"/>',
  digital: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  living: '<path d="M5 11V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4M5 18v3m14-3v3"/><path d="M5 11a2 2 0 0 0-3 2v5h20v-5a2 2 0 0 0-4 0v1H6v-1a2 2 0 0 0-1-2Z"/>',
  mark: '<circle cx="9" cy="12" r="7"/><circle cx="17" cy="13" r="7"/>',
  pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9m-8 12a2 2 0 0 0 4 0"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  sparkle: '<path d="M12 2c1.1 6.2 3.8 8.9 10 10-6.2 1.1-8.9 3.8-10 10C10.9 15.8 8.2 13.1 2 12 8.2 10.9 10.9 8.2 12 2Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  heart: '<path d="M20.8 8.7c0 3.9-4.4 6.9-8.8 11-4.4-4.1-8.8-7.1-8.8-11a4.8 4.8 0 0 1 8.8-2.6 4.8 4.8 0 0 1 8.8 2.6Z"/>',
  home: '<path d="m3 11 9-8 9 8v8a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2Z"/>',
  chat: '<path d="M21 11.2a8.8 8.8 0 0 1-9.2 8.2 10 10 0 0 1-3.2-.5L4 21l1.3-3.6A7.8 7.8 0 0 1 3 11.2 8.7 8.7 0 0 1 12 3a8.7 8.7 0 0 1 9 8.2Z"/><path d="M8 11h.1m3.9 0h.1m3.9 0h.1" stroke-width="2.5"/>',
  send: '<path d="m22 2-7 20-4-9-9-4 20-7Zm0 0L11 13"/>',
  user: '<circle cx="12" cy="7.5" r="3.75"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  photo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m4 17 5-4 4 4 3-3 4 4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4m-4 4v2"/>',
  more: '<circle cx="5" cy="12" r=".8"/><circle cx="12" cy="12" r=".8"/><circle cx="19" cy="12" r=".8"/>',
  trash: '<path d="M4 7h16m-10 4v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};

export function icon(name) {
  return `<svg viewBox="${name === "mark" ? "0 0 26 24" : "0 0 24 24"}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${shapes[name]}</svg>`;
}
