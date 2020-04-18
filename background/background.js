/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

import {
  configs
} from '/common/common.js';

const TST_ID = 'treestyletab@piro.sakura.ne.jp';

const KEY_LOCKED_COLLAPSED = 'tst-lock-tree-collapsed-locked-collapsed';

const lockedTabs = new Set();

const menuItemDefinition = {
  id:       'locked-collapsed',
  type:     'checkbox',
  checked:  false,
  title:    browser.i18n.getMessage('context_lockCollapsed_label'),
  contexts: ['tab'],
  visible:  true
};
browser.menus.create(menuItemDefinition);

async function registerToTST() {
  try {
    const base = `moz-extension://${location.host}`;
    await browser.runtime.sendMessage(TST_ID, {
      type: 'register-self',
      name: browser.i18n.getMessage('extensionName'),
      //icons: browser.runtime.getManifest().icons,
      listeningTypes: [
        'sidebar-show',
        'try-expand-tree-from-focused-parent',
        'try-expand-tree-from-focused-bundled-parent',
        'try-expand-tree-from-attached-child',
        'try-expand-tree-from-long-press-ctrl-key',
        'try-expand-tree-from-end-tab-switch',
        'try-expand-tree-from-focused-collapsed-tab',
        'try-redirect-focus-from-collaped-tab',
        'try-fixup-tree-on-tab-moved',
        'tab-dblclicked',
        'fake-contextMenu-shown'
      ],
      style: `
        tab-item:not(.collapsed).${KEY_LOCKED_COLLAPSED} tab-twisty::before {
          background: url("${base}/resources/ArrowheadDownDouble.svg") no-repeat center / 60%;
        }
        :root.simulate-svg-context-fill tab-item:not(.collapsed).${KEY_LOCKED_COLLAPSED} tab-twisty::before {
          background: var(--tab-text);
          mask: url("${base}/resources/ArrowheadDownDouble.svg") no-repeat center / 60%;
        }
      `
    });
    browser.runtime.sendMessage(TST_ID, {
      type:   'fake-contextMenu-create',
      params: menuItemDefinition
    });
  }
  catch(_error) {
    // TST is not available
  }
}
registerToTST();

let lastRedirectedParent;
let mMovedTabsInfo = [];

browser.runtime.onMessageExternal.addListener((message, sender) => {
  switch (sender.id) {
    case TST_ID:
      switch (message.type) {
        case 'ready':
          registerToTST();
          break;

        case 'sidebar-show':
          browser.tabs.query({ windowId: message.windowId }).then(tabs => {
            for (const tab of tabs) {
              restoreLockedState(tab.id);
            }
          });
          break;

        case 'try-expand-tree-from-focused-parent':
          if ((configs.blockExpansionFromFocusedParent ||
               lastRedirectedParent == message.tab.id) &&
              lockedTabs.has(message.tab.id))
            return Promise.resolve(true);
          break;

        case 'try-expand-tree-from-focused-bundled-parent':
          if (configs.blockExpansionFromFocusedBundledParent &&
              lockedTabs.has(message.tab.id))
            return Promise.resolve(true);
          break;

        case 'try-expand-tree-from-attached-child':
          if (configs.blockExpansionFromAttachedChild &&
              lockedTabs.has(message.tab.id))
            return Promise.resolve(true);
          break;

        case 'try-expand-tree-from-long-press-ctrl-key':
          if (configs.blockExpansionFromLongPressCtrlKey &&
              lockedTabs.has(message.tab.id))
            return Promise.resolve(true);
          break;

        case 'try-expand-tree-from-end-tab-switch':
          if (configs.blockExpansionFromEndTabSwitch &&
              lockedTabs.has(message.tab.id))
            return Promise.resolve(true);
          break;

        case 'try-expand-tree-from-focused-collapsed-tab':
          if (!configs.blockExpansionFromFocusedCollapsedTab)
            return;
          return (async () => {
            const lockedCollapsedAncestors = await browser.runtime.sendMessage(TST_ID, {
              type: 'get-tree',
              tabs:  message.tab.ancestorTabIds.filter(id => lockedTabs.has(id))
            });
            const nearestLockedCollapsedAncestor = lockedCollapsedAncestors.find(
              tab => tab.states.includes('subtree-collapsed') && lockedTabs.has(tab.id)
            );
            if (nearestLockedCollapsedAncestor)
              return true;
            return false;
          })();

        case 'try-redirect-focus-from-collaped-tab':
          return (async () => {
            const [treeTabs, willCancel] = await Promise.all([
              browser.runtime.sendMessage(TST_ID, {
                type: 'get-tree',
                tabs: ['nextVisibleCyclic', 'previousVisibleCyclic']
                  .concat(message.tab.ancestorTabIds.filter(id => lockedTabs.has(id)))
              }),
              browser.runtime.sendMessage('tst-active-tab-in-collapsed-tree@piro.sakura.ne.jp', {
                type:           'will-cancel-expansion-from-focused-collapsed-tab',
                tabId:          message.tab.id,
                ancestorTabIds: message.tab.ancestorTabIds
              }).catch(_e => { return false; })
            ]);
            const [nextVisible, previousVisible, ...lockedCollapsedAncestors] = treeTabs;
            if (willCancel)
              return true;

            const nearestLockedCollapsedAncestor = lockedCollapsedAncestors.find(
              tab => tab.states.includes('subtree-collapsed') && lockedTabs.has(tab.id)
            );
            // In such case we must not refocus tab, because it may produce
            // unexpected focus back like:
            // https://github.com/piroor/tst-lock-tree-collapsed/issues/4
            if (!hasActiveDescendant(nearestLockedCollapsedAncestor))
              return;

            lastRedirectedParent = nearestLockedCollapsedAncestor.id;
            // immediate refocus may cause unhighlighted active tab on TS...
            setTimeout(() => {
              browser.tabs.update(
                message.focusDirection < 0 ?
                  previousVisible.id :
                  nextVisible.id,
                { active: true }
              );
              setTimeout(() => {
                lastRedirectedParent = null;
              }, 250);
            }, 0);
            return true;
          })();

        case 'try-fixup-tree-on-tab-moved':
          if (message.tab.active && // Ignore moves on non-active tabs
              Math.abs(message.fromIndex - message.toIndex) == 1 && // process only move-up or move-down
              message.parent &&
              (lockedTabs.has(message.parent.id) ||
               message.parent.ancestorTabIds.some(id => lockedTabs.has(id)))) {
            return (async () => {
              const ancestors = [message.parent].concat(await browser.runtime.sendMessage(TST_ID, {
                type: 'get-tree',
                tabs: message.parent.ancestorTabIds
              }));
              const visibleLockedAncestors = ancestors.filter(ancestor =>
                lockedTabs.has(ancestor.id) &&
                  ancestor.states.includes('subtree-collapsed') &&
                    !ancestor.states.includes('collapsed')
              );
              if (visibleLockedAncestors.length == 0)
                return;
              const nearestVisibleParent = visibleLockedAncestors[visibleLockedAncestors.length - 1];
              mMovedTabsInfo = mMovedTabsInfo.filter(info => info.id != message.tab.id);
              mMovedTabsInfo.push({
                id:        message.tab.id,
                tab:       message.tab,
                toIndex:   message.toIndex,
                fromIndex: message.fromIndex,
                nearestVisibleParent
              });
              reserveToProcessMovedTabs();
              return Promise.resolve(true);
            })();
          }
          break;

        case 'tab-dblclicked':
          if (message.button != 0 ||
              message.twisty ||
              message.soundButton ||
              message.closebox ||
              message.altKey ||
              message.ctrlKey ||
              message.metaKey ||
              message.shiftKey ||
              !configs.toggleByDblClick)
            return;
          return (async () => {
            const tab = await browser.runtime.sendMessage(TST_ID, {
              type: 'get-tree',
              tab:  message.tab.id
            });
            if (tab.children.length == 0)
              return false;
            toggleTabLocked(tab.id);
            /*
            if (lockedTabs.has(tab.id)) {
              browser.runtime.sendMessage(TST_ID, {
                type: 'collapse-tree',
                tab:  tab.id
              });
            }
            */
            return true;
          })();

        case 'fake-contextMenu-shown':
          onMenuShown(message.info, message.tab);
          break;

        case 'fake-contextMenu-click':
          onMenuClicked(message.info, message.tab);
          break;
      }
      break;
  }
});

function hasActiveDescendant(tab) {
  if (tab.active)
    return true;
  return tab.children.some(hasActiveDescendant) || tab.active;
}

browser.tabs.onCreated.addListener(tab => {
  restoreLockedState(tab.id);
});

const mActiveTabs = new Map();

browser.tabs.onActivated.addListener(activeInfo => {
  setTimeout(() => {
    mActiveTabs.set(activeInfo.windowId, activeInfo.tabId);
  }, 250);
});

browser.windows.onRemoved.addListener(windowId => {
  mActiveTabs.delete(windowId);
});

browser.tabs.onRemoved.addListener(tabId => {
  lockedTabs.delete(tabId);
});

function reserveToProcessMovedTabs() {
  if (reserveToProcessMovedTabs.reserved)
    clearTimeout(reserveToProcessMovedTabs.reserved);
  reserveToProcessMovedTabs.reserved = setTimeout(() => {
    reserveToProcessMovedTabs.reserved = null;
    processMovedTabs();
  }, 150);
}
reserveToProcessMovedTabs.reserved = null;

async function processMovedTabs() {
  // When tabs are moved into a locked-collapsed tree with
  // Ctrl-Shift-PageUp/PageDown, we should move them away.
  // https://github.com/piroor/tst-lock-tree-collapsed/issues/10
  const movedTabsInfo = mMovedTabsInfo;
  mMovedTabsInfo = [];
  console.log(movedTabsInfo);

  const tabIds    = movedTabsInfo.map(info => info.id);
  const tabIdsSet = new Set(tabIds);
  const tabs      = await browser.runtime.sendMessage(TST_ID, {
    type: 'get-tree',
    tabs: tabIds
  });

  {
    for (let i = 0, maxi = tabs.length; i < maxi; i++) {
      const tab = tabs[i];
      tab.fromIndex = movedTabsInfo[i].fromIndex;
      tab.toIndex   = movedTabsInfo[i].toIndex;
      tab.active    = movedTabsInfo[i].tab.active;
      tab.nearestVisibleParent = movedTabsInfo[i].nearestVisibleParent;
    }
  }

  const rootTabs = tabs.filter(tab => tab.ancestorTabIds.every(id => !tabIdsSet.has(id)));
  for (const rootTab of rootTabs) {
    if ((rootTab.fromIndex - rootTab.toIndex) == 1) {
      //console.log('move up ', { rootTab });
      await browser.runtime.sendMessage(TST_ID, {
        type:           'move-before',
        tab:            rootTab.id,
        referenceTabId: rootTab.nearestVisibleParent.id,
        followChildren: true
      });
      browser.tabs.update(rootTab.id, { active: true });
    }
    else if ((rootTab.toIndex - rootTab.fromIndex) == 1) {
      //console.log('move down ', { rootTab });
      const lastDescendantId = getLastDescendantOrSelfId(rootTab.nearestVisibleParent);
      if (rootTab.nearestVisibleParent.ancestorTabIds.length > 0) {
        //console.log(' => reattach to the parennt ', rootTab.nearestVisibleParent.ancestorTabIds[0]);
        await browser.runtime.sendMessage(TST_ID, {
          type:        'attach',
          parent:      rootTab.nearestVisibleParent.ancestorTabIds[0],
          child:       rootTab.id,
          insertAfter: lastDescendantId
        });
      }
      else {
        //console.log(' => detach from tree');
        await browser.runtime.sendMessage(TST_ID, {
          type:           'move-after',
          tab:            rootTab.id,
          referenceTabId: lastDescendantId,
          followChildren: true
        });
        await browser.runtime.sendMessage(TST_ID, {
          type: 'detach',
          tab:  rootTab.id
        });
      }
      browser.tabs.update(rootTab.id, { active: true });
    }
  }
}

function getLastDescendantOrSelfId(tab) {
  if (tab.children.length > 0)
    return getLastDescendantOrSelfId(tab.children[tab.children.length - 1])
  return tab.id;
}

async function onMenuShown(info, tab) {
  const updateParams = {};
  if (configs.context_lockCollapsed != menuItemDefinition.visible) {
    updateParams.visible       = configs.context_lockCollapsed;
    menuItemDefinition.visible = updateParams.visible;
  }
  const checked = tab && lockedTabs.has(tab.id);
  if (checked != menuItemDefinition.checked) {
    updateParams.checked       = checked;
    menuItemDefinition.checked = checked;
  }
  if (Object.keys(updateParams).length > 0) {
    browser.menus.update(menuItemDefinition.id, updateParams).then(() => {
      browser.menus.refresh();
    });
    browser.runtime.sendMessage(TST_ID, {
      type:   'fake-contextMenu-update',
      params: [menuItemDefinition.id, updateParams]
    });
  }
}
browser.menus.onShown.addListener(onMenuShown);

async function onMenuClicked(info, tab) {
  switch(info.menuItemId) {
    case menuItemDefinition.id:
      if (!tab)
        return;
      const tabs = await getMultiselectedTabs(tab);
      const locked = lockedTabs.has(tabs[0].id);
      for (const tab of tabs) {
        if (locked)
          unlockTab(tab.id);
        else
          lockTab(tab.id);
      }
      break;
  }
}
browser.menus.onClicked.addListener(onMenuClicked);

export async function getMultiselectedTabs(tab) {
  if (!tab)
    return [];
  if (tab.highlighted)
    return browser.tabs.query({
      windowId:    tab.windowId,
      highlighted: true
    });
  else
    return [tab];
}

browser.commands.onCommand.addListener(async command => {
  const activeTabs = await browser.tabs.query({
    active:        true,
    currentWindow: true
  });
  const miltiselectedTabs = await getMultiselectedTabs(activeTabs[0]);
  switch (command) {
    case 'toggleLockCollapsed':
      const locked = lockedTabs.has(activeTabs[0].id);
      for (const tab of miltiselectedTabs) {
        if (locked)
          unlockTab(tab.id);
        else
          lockTab(tab.id);
      }
      return;
  }
});


async function restoreLockedState(id) {
  let locked = await browser.sessions.getTabValue(id, KEY_LOCKED_COLLAPSED);
  if (typeof locked != 'boolean')
    locked = configs.lockByDefault;

  if (locked)
    lockTab(id);
  else
    unlockTab(id);
}

function toggleTabLocked(id) {
  if (lockedTabs.has(id))
    unlockTab(id);
  else
    lockTab(id);
}

function lockTab(id) {
  lockedTabs.add(id);
  browser.runtime.sendMessage(TST_ID, {
    type:  'add-tab-state',
    tabs:  [id],
    state: [KEY_LOCKED_COLLAPSED]
  });
  browser.sessions.setTabValue(id, KEY_LOCKED_COLLAPSED, true);
}

function unlockTab(id) {
  lockedTabs.delete(id);
  browser.runtime.sendMessage(TST_ID, {
    type:  'remove-tab-state',
    tabs:  [id],
    state: [KEY_LOCKED_COLLAPSED]
  });
  browser.sessions.removeTabValue(id, KEY_LOCKED_COLLAPSED);
}

browser.tabs.query({}).then(tabs => {
  for (const tab of tabs) {
    restoreLockedState(tab.id);
  }
});
