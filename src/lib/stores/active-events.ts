import { get, writable } from 'svelte/store';

export const indexPageSize = 200;
export const startIndex = writable(0);
export const endIndex = writable(indexPageSize);

export const activeGroups = writable<string[]>([]);
export const activeGroupHeight = writable<number>(0);

export const clearActives = () => {
  activeGroups.set([]);
  activeGroupHeight.set(0);
  startIndex.set(0);
  endIndex.set(indexPageSize);
};

export const clearActiveGroups = () => {
  activeGroups.set([]);
  activeGroupHeight.set(0);
};

export const setActiveGroup = (group: { id: string }, key = group.id) => {
  if (!get(activeGroups).includes(key)) {
    activeGroups.set([key]);
  } else {
    activeGroupHeight.set(0);
    activeGroups.set([]);
  }
};
