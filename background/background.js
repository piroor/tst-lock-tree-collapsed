/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

import {
  configs,
  wait,
  log,
} from '/common/common.js';

const TST_ID = 'treestyletab@piro.sakura.ne.jp';

const KEY_LOCKED_COLLAPSED = 'tst-lock-tree-collapsed-locked-collapsed';

const lockedTabs = new Set();
let mGetTreeType = 'get-tree';

const menuItemDefinitions = {
  lockCollapsed: {
    id:       'locked-collapsed',
    type:     'checkbox',
    checked:  false,
    title:    browser.i18n.getMessage('context_lockCollapsed_label'),
    contexts: ['tab'],
    visible:  true,
  },
  expandExceptLocked: {
    id:       'expand-except-locked',
    title:    browser.i18n.getMessage('context_expandExceptLocked_label'),
    contexts: ['tab'],
    visible:  false,
  },
  expandAllExceptLocked: {
    id:       'expand-all-except-locked',
    title:    browser.i18n.getMessage('context_expandAllExceptLocked_label'),
    contexts: ['tab'],
    visible:  false,
  },
};
for (const definition of Object.values(menuItemDefinitions)) {
  browser.menus.create(definition);
}

async function registerToTST() {
  try {
    const base = `moz-extension://${location.host}`;

    const listeningTypes = [
      'sidebar-show',
      'try-redirect-focus-from-collaped-tab',
      'try-fixup-tree-on-tab-moved',
      'tab-dblclicked',
      'fake-contextMenu-shown',
    ];
    if (configs.blockExpansionFromFocusedParent)
      listeningTypes.push('try-expand-tree-from-focused-parent');
    if (configs.blockExpansionFromFocusedBundledParent)
      listeningTypes.push('try-expand-tree-from-focused-bundled-parent');
    if (configs.blockExpansionFromAttachedChild) {
      listeningTypes.push('try-expand-tree-from-attached-child');
      listeningTypes.push('new-tab-processed');
    }
    if (configs.blockExpansionFromLongPressCtrlKey)
      listeningTypes.push('try-expand-tree-from-long-press-ctrl-key');
    if (configs.blockExpansionFromEndTabSwitch)
      listeningTypes.push('try-expand-tree-from-end-tab-switch');
    if (configs.blockExpansionFromFocusedCollapsedTab)
      listeningTypes.push('try-expand-tree-from-focused-collapsed-tab');
    if (configs.blockExpansionFromExpandCommand)
      listeningTypes.push('try-expand-tree-from-expand-command');
    if (configs.blockExpansionFromExpandAllCommand)
      listeningTypes.push('try-expand-tree-from-expand-all-command');
    if (configs.blockCollapsionFromOtherExpansion)
      listeningTypes.push('try-collapse-tree-from-other-expansion');
    if (configs.blockCollapsionFromCollapseCommand)
      listeningTypes.push('try-collapse-tree-from-collapse-command');
    if (configs.blockCollapsionFromCollapseCommand)
      listeningTypes.push('try-collapse-tree-from-collapse-all-command');

    const [TSTVersion] = await Promise.all([
      browser.runtime.sendMessage(TST_ID, { type: 'get-version' }),
      browser.runtime.sendMessage(TST_ID, {
        type: 'register-self',
        name: browser.i18n.getMessage('extensionName'),
        //icons: browser.runtime.getManifest().icons,
        listeningTypes,
        allowBulkMessaging: true,
        lightTree: true,
        style: `
          tab-item:not(.collapsed).${KEY_LOCKED_COLLAPSED} tab-twisty::before {
            background: url("${base}/resources/ArrowheadDownDouble.svg") no-repeat center / 60%;
          }
          :root.simulate-svg-context-fill tab-item:not(.collapsed).${KEY_LOCKED_COLLAPSED} tab-twisty::before {
            background: var(--tab-text);
            mask: url("${base}/resources/ArrowheadDownDouble.svg") no-repeat center / 60%;
          }
        `
      }),
    ]);
    if (TSTVersion && parseInt(TSTVersion.split('.')[0]) >= 4) {
      mGetTreeType = 'get-light-tree';
    }
    else {
      mGetTreeType = 'get-tree';
    }

    for (const params of Object.values(menuItemDefinitions)) {
      browser.runtime.sendMessage(TST_ID, {
        type: 'fake-contextMenu-create',
        params,
      });
    }
  }
  catch(_error) {
    // TST is not available
  }
}
configs.$loaded.then(registerToTST);

configs.$addObserver(key => {
  switch (key) {
    case 'blockExpansionFromFocusedParent':
    case 'blockExpansionFromFocusedBundledParent':
    case 'blockExpansionFromAttachedChild':
    case 'blockExpansionFromLongPressCtrlKey':
    case 'blockExpansionFromEndTabSwitch':
    case 'blockExpansionFromFocusedCollapsedTab':
    case 'blockExpansionFromExpandCommand':
    case 'blockExpansionFromExpandAllCommand':
    case 'blockCollapsionFromOtherExpansion':
    case 'blockCollapsionFromCollapseCommand':
    case 'blockCollapsionFromCollapseAllCommand':
      browser.runtime.sendMessage(TST_ID, { type: 'unregister-self' }).then(registerToTST);
      break;

    default:
      break;
  }
});

let lastRedirectedParent;
let mMovedTabsInfo = [];
const mWaitingProcessedTabsResolvers = new Map();

function onMessageExternal(message, sender) {
  switch (sender.id) {
    case TST_ID:
      if (message && message.messages) {
        for (const oneMessage of message.messages) {
          onMessageExternal(oneMessage, sender);
        }
        break;
      }
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
          log(message.type, { message, lastRedirectedParent, locked: lockedTabs.has(message.tab.id) });
          if ((configs.blockExpansionFromFocusedParent ||
               lastRedirectedParent == message.tab.id) &&
              lockedTabs.has(message.tab.id))
            return Promise.resolve(true);
          break;

        case 'try-expand-tree-from-focused-bundled-parent':
          log(message.type, { message, locked: lockedTabs.has(message.tab.id) });
          if (configs.blockExpansionFromFocusedBundledParent &&
              lockedTabs.has(message.tab.id))
            return Promise.resolve(true);
          break;

        case 'try-expand-tree-from-attached-child':
          log(message.type, { message, locked: lockedTabs.has(message.tab.id) });
          if (configs.blockExpansionFromAttachedChild &&
              message.tab.states.includes('subtree-collapsed') &&
              lockedTabs.has(message.tab.id)) {
            tryProcessChildAttachedInLockedCollapsedTree({
              child:  message.child,
              parent: message.tab,
            });
            return Promise.resolve(true);
          }
          break;

        case 'new-tab-processed': {
          const resolvers = mWaitingProcessedTabsResolvers.get(message.tab.id);
          mWaitingProcessedTabsResolvers.delete(message.tab.id);
          if (resolvers) {
            for (const resolver of resolvers) {
              resolver();
            }
          }
        }; break;

        case 'try-expand-tree-from-long-press-ctrl-key':
          log(message.type, { message, locked: lockedTabs.has(message.tab.id) });
          if (configs.blockExpansionFromLongPressCtrlKey &&
              lockedTabs.has(message.tab.id))
            return Promise.resolve(true);
          break;

        case 'try-expand-tree-from-end-tab-switch':
          log(message.type, { message, locked: lockedTabs.has(message.tab.id) });
          if (configs.blockExpansionFromEndTabSwitch &&
              lockedTabs.has(message.tab.id))
            return Promise.resolve(true);
          break;

        case 'try-expand-tree-from-focused-collapsed-tab':
          log(message.type, { message, locked: lockedTabs.has(message.tab.id) });
          if (!configs.blockExpansionFromFocusedCollapsedTab)
            return;
          return (async () => {
            const lockedCollapsedAncestors = await browser.runtime.sendMessage(TST_ID, {
              type: mGetTreeType,
              tabs: message.tab.ancestorTabIds.filter(id => lockedTabs.has(id)),
            });
            const nearestLockedCollapsedAncestor = lockedCollapsedAncestors.find(
              tab => tab.states.includes('subtree-collapsed') && lockedTabs.has(tab.id)
            );
            if (nearestLockedCollapsedAncestor)
              return true;
            return false;
          })();

        case 'try-expand-tree-from-expand-command':
          log(message.type, { message, locked: lockedTabs.has(message.tab.id) });
          if (configs.blockExpansionFromExpandCommand &&
              message.recursivelyExpanded &&
              lockedTabs.has(message.tab.id))
            return Promise.resolve(true);
          break;

        case 'try-expand-tree-from-expand-all-command':
          log(message.type, { message, locked: lockedTabs.has(message.tab.id) });
          if (configs.blockExpansionFromExpandAllCommand &&
              lockedTabs.has(message.tab.id))
            return Promise.resolve(true);
          break;

        case 'try-collapse-tree-from-other-expansion':
          log(message.type, { message, locked: lockedTabs.has(message.tab.id) });
          if (!configs.blockCollapsionFromOtherExpansion)
            return;
          return (async () => {
            const lockedExpandedTabs = await browser.runtime.sendMessage(TST_ID, {
              type: mGetTreeType,
              tabs: message.tab.ancestorTabIds.filter(id => lockedTabs.has(id))
            });
            const nearestLockedExpandedTab = [message.tab, ...lockedExpandedTabs].find(
              tab => !tab.states.includes('subtree-collapsed') && lockedTabs.has(tab.id)
            );
            if (nearestLockedExpandedTab)
              return true;
            return false;
          })();

        case 'try-collapse-tree-from-collapse-command':
          log(message.type, { message, locked: lockedTabs.has(message.tab.id) });
          if (configs.blockCollapsionFromCollapseCommand &&
              message.recursivelyCollapsed &&
              lockedTabs.has(message.tab.id))
            return Promise.resolve(true);
          break;

        case 'try-collapse-tree-from-collapse-all-command':
          log(message.type, { message, locked: lockedTabs.has(message.tab.id) });
          if (configs.blockCollapsionFromCollapseAllCommand &&
              lockedTabs.has(message.tab.id))
            return Promise.resolve(true);
          break;

        case 'try-redirect-focus-from-collaped-tab':
          log(message.type, { message });
          return (async () => {
            const [treeTabs, willCancel] = await Promise.all([
              browser.runtime.sendMessage(TST_ID, {
                type: mGetTreeType,
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
              log('redirect focus');
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
          log(message.type, { message });
          if (message.tab.active && // Ignore moves on non-active tabs
              Math.abs(message.fromIndex - message.toIndex) == 1 && // process only move-up or move-down
              message.parent &&
              (lockedTabs.has(message.parent.id) ||
               message.parent.ancestorTabIds.some(id => lockedTabs.has(id)))) {
            return (async () => {
              const ancestors = [message.parent].concat(await browser.runtime.sendMessage(TST_ID, {
                type: mGetTreeType,
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
                tab:       await browser.tabs.get(message.tab.id).then(tab => ({ ...tab, ...message.tab })),
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
            const treeItem = await browser.runtime.sendMessage(TST_ID, {
              type: mGetTreeType,
              tab:  message.tab.id
            });
            if (!treeItem || treeItem.children.length == 0)
              return false;
            toggleTabLocked(treeItem.id);
            /*
            if (lockedTabs.has(treeItem.id)) {
              browser.runtime.sendMessage(TST_ID, {
                type: 'collapse-tree',
                tab:  treeItem.id
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
}
browser.runtime.onMessageExternal.addListener(onMessageExternal);

function hasActiveDescendant(tab) {
  if (!tab)
    return false;
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

async function tryProcessChildAttachedInLockedCollapsedTree({ child, parent }) {
  log('tryProcessChildAttachedInLockedCollapsedTree ', { child, parent });
  if (child && !child.states.includes('creating'))
    return;

  const wasActive = (await browser.tabs.get(child.id)).active;

  const resolvers = mWaitingProcessedTabsResolvers.get(child.id) || [];
  const promisedProcessed = new Promise((resolve, _reject) => {
    resolvers.push(resolve);
    mWaitingProcessedTabsResolvers.set(child.id, resolvers);
  });
  await promisedProcessed;

  // wait until tab move by TST finishes
  await wait(configs.redirectChildNotFromExistingTabsUnderLockedCollapsedTreeDelayMsec);

  // to get finally detected states
  child = await browser.runtime.sendMessage(TST_ID, { type: 'get-light-tree', tab: child.id });

  const childStates = new Set(child.states);
  log('states: ', childStates);
  if (!(childStates.has('newtab-command-tab') ||
        childStates.has('duplicated') ||
        childStates.has('restored') ||
        childStates.has('from-external') ||
        childStates.has('from-firefox-view') ||
        childStates.has('opened-for-same-website')))
    return;

  switch (configs.redirectChildNotFromExistingTabsUnderLockedCollapsedTree) {
    case 'none':
      break;

    case 'independent': {
      const tabs = await browser.tabs.query({ windowId: parent.windowId });
      await browser.runtime.sendMessage(TST_ID, {
        type: 'detach',
        tab:  child.id,
      });
      await browser.tabs.move(child.id, {
        windowId: parent.windowId,
        index:    tabs.length-1,
      });
    }; break;

    case 'nextsibling': {
      const [ancestors, nextSiblings] = await Promise.all([
        browser.runtime.sendMessage(TST_ID, {
          type: 'get-light-tree',
          tabs: child.ancestorTabIds,
        }),
        browser.runtime.sendMessage(TST_ID, {
          type: 'get-light-tree',
          tabs: child.ancestorTabIds.map(id => `nextSibling-of-${id}`),
        }),
      ]);
      log('redirect to next sibling ', { ancestors, nextSiblings });
      for (let i = 0, maxi = ancestors.length; i < maxi; i++) {
        const ancestor = ancestors[i];
        const nextSibling = nextSiblings[i];
        if (ancestor.states.includes('collapsed'))
          continue;
        if (ancestor.ancestorTabIds[0]) {
          await browser.runtime.sendMessage(TST_ID, {
            type: 'attach',
            parent: ancestor.ancestorTabIds[0],
            child:  child.id,
            insertBefore: nextSibling?.id,
          });
        }
        else if (nextSibling) {
          const [nextSiblingTab] = await Promise.all([
            browser.tabs.get(nextSibling.id),
            browser.runtime.sendMessage(TST_ID, {
              type: 'detach',
              tab:  child.id,
            }),
          ]);
          log('next sibling: ', nextSiblingTab, nextSiblingTab.index);
          await browser.tabs.move(child.id, {
            windowId: parent.windowId,
            index:    nextSiblingTab.index - 1,
          });
        }
        else {
          const tabs = await browser.tabs.query({ windowId: parent.windowId });
          await browser.runtime.sendMessage(TST_ID, {
            type: 'detach',
            tab:  child.id,
          });
          await browser.tabs.move(child.id, {
            windowId: child.windowId,
            index:    tabs.length - 1,
          });
        }
        break;
      }
    }; break;
  }

  if (wasActive)
    browser.tabs.update(child.id, { active: true });
}

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
  log('processMovedTabs ', movedTabsInfo);

  const tabIds    = movedTabsInfo.map(info => info.id);
  const tabIdsSet = new Set(tabIds);
  const tabs      = await browser.runtime.sendMessage(TST_ID, {
    type: mGetTreeType,
    tabs: tabIds,
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
      log('move up ', { rootTab });
      await browser.runtime.sendMessage(TST_ID, {
        type:           'move-before',
        tab:            rootTab.id,
        referenceTabId: rootTab.nearestVisibleParent.id,
        followChildren: true
      });
      browser.tabs.update(rootTab.id, { active: true });
    }
    else if ((rootTab.toIndex - rootTab.fromIndex) == 1) {
      log('move down ', { rootTab });
      const lastDescendantId = getLastDescendantOrSelfId(rootTab.nearestVisibleParent);
      if (rootTab.nearestVisibleParent.ancestorTabIds.length > 0) {
        log(' => reattach to the parennt ', rootTab.nearestVisibleParent.ancestorTabIds[0]);
        await browser.runtime.sendMessage(TST_ID, {
          type:        'attach',
          parent:      rootTab.nearestVisibleParent.ancestorTabIds[0],
          child:       rootTab.id,
          insertAfter: lastDescendantId
        });
      }
      else {
        log(' => detach from tree');
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
  const multiselectedTabs = await getMultiselectedTabs(tab);
  const treeItems = await appendTreeInfo(multiselectedTabs);
  const treeItemForTab = treeItems.find(treeItem => treeItem.id == tab.id);
  const shouldEnable = {
    lockCollapsed: (treeItemForTab && treeItemForTab.children.length > 0),
    expandExceptLocked: treeItems.some(treeItem => treeItem.children.length > 0),
    expandAllExceptLocked: true,
  };

  const updates = [];
  for (const [id, params] of Object.entries(menuItemDefinitions)) {
    const updateParams = {};
    const configKey = `context_${id}`;
    const visible = configs[configKey] && shouldEnable[id];
    if (visible != params.visible) {
      updateParams.visible = visible;
      params.visible = updateParams.visible;
    }
    if (params.type == 'checkbox') {
      const checked = tab && lockedTabs.has(tab.id);
      if (checked != params.checked) {
        updateParams.checked       = checked;
        params.checked = checked;
      }
    }
    if (Object.keys(updateParams).length > 0) {
      updates.push(browser.menus.update(params.id, updateParams));
      browser.runtime.sendMessage(TST_ID, {
        type:   'fake-contextMenu-update',
        params: [params.id, updateParams]
      });
    }
  }
  if (updates.length > 0)
    Promise.all(updates).then(() => {
      browser.menus.refresh();
    });
}
browser.menus.onShown.addListener(onMenuShown);

async function onMenuClicked(info, tab) {
  if (!tab)
    return;
  switch(info.menuItemId) {
    case menuItemDefinitions.lockCollapsed.id:
      toggleCollapsed(tab, await getMultiselectedTabs(tab));
      break;

    case menuItemDefinitions.expandExceptLocked.id:
      expandExceptLocked(await getMultiselectedTabs(tab));
      break;

    case menuItemDefinitions.expandAllExceptLocked.id:
      expandAllExceptLocked(tab.windowId);
      break;
  }
}
browser.menus.onClicked.addListener(onMenuClicked);

async function getMultiselectedTabs(tab) {
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

function toggleCollapsed(activeTab, tabs) {
  const locked = lockedTabs.has(activeTab.id);
  for (const tab of tabs) {
    if (locked)
      unlockTab(tab.id);
    else
      lockTab(tab.id);
  }
}

async function appendTreeInfo(tabs) {
  const treeItems = await browser.runtime.sendMessage(TST_ID, {
    type: mGetTreeType,
    tabs: tabs.map(tab => tab.id),
  });
  return tabs.map((tab, index) => ({
    ...tab,
    ...treeItems[index],
  }));
}

function flattenTreeItems(treeItems) {
  const flattenedItems = [];
  for (const treeItem of treeItems) {
    flattenedItems.push(treeItem, ...flattenTreeItems(treeItem.children));
  }
  return flattenedItems;
}

function extractExpandableTreeItems(treeItems) {
  return treeItems.filter(treeItem => (
    !lockedTabs.has(treeItem.id) &&
    treeItem.children.length > 0 &&
    treeItem.states.includes('subtree-collapsed') &&
    !treeItem.ancestorTabIds.some(id => lockedTabs.has(id))
  ));
}

async function expandExceptLocked(tabs) {
  const treeItems = flattenTreeItems(await appendTreeInfo(tabs));
  browser.runtime.sendMessage(TST_ID, {
    type: 'expand-tree',
    tabs: extractExpandableTreeItems(treeItems).map(treeItem => treeItem.id),
  });
}

async function expandAllExceptLocked(windowId) {
  const tabs = await browser.tabs.query({
    windowId,
    hidden: false,
  });
  const treeItems = await appendTreeInfo(tabs);
  browser.runtime.sendMessage(TST_ID, {
    type: 'expand-tree',
    tabs: extractExpandableTreeItems(treeItems).map(treeItem => treeItem.id),
  });
}

browser.commands.onCommand.addListener(async command => {
  const activeTabs = await browser.tabs.query({
    active:        true,
    currentWindow: true,
  });
  switch (command) {
    case 'toggleLockCollapsed':
      toggleCollapsed(activeTabs[0], await getMultiselectedTabs(activeTabs[0]));
      return;

    case 'expandExceptLocked':
      expandExceptLocked(await getMultiselectedTabs(activeTabs[0]));
      return;

    case 'expandAllExceptLocked':
      expandAllExceptLocked(activeTabs[0].windowId);
      return;
  }
});


async function restoreLockedState(id) {
  let locked = await browser.sessions.getTabValue(id, KEY_LOCKED_COLLAPSED);
  if (typeof locked != 'boolean')
    locked = configs.lockByDefault;

  if (locked)
    lockTab(id, { restore: true });
  else
    unlockTab(id, { restore: true });
}

function toggleTabLocked(id) {
  if (lockedTabs.has(id))
    unlockTab(id);
  else
    lockTab(id);
}

const mToBeLockedTabIds = new Set();

function lockTab(id, { restore } = {}) {
  lockedTabs.add(id);
  if (restore) {
    mToBeLockedTabIds.add(id);
    reserveBulkLockUnlockToRestore();
    return;
  }
  browser.runtime.sendMessage(TST_ID, {
    type:  'add-tab-state',
    tabs:  [id],
    state: [KEY_LOCKED_COLLAPSED]
  });
  browser.sessions.setTabValue(id, KEY_LOCKED_COLLAPSED, true);
}

const mToBeUnlockedTabIds = new Set();

function unlockTab(id, { restore } = {}) {
  lockedTabs.delete(id);
  if (restore) {
    mToBeUnlockedTabIds.add(id);
    reserveBulkLockUnlockToRestore();
    return;
  }
  browser.runtime.sendMessage(TST_ID, {
    type:  'remove-tab-state',
    tabs:  [id],
    state: [KEY_LOCKED_COLLAPSED]
  });
  browser.sessions.removeTabValue(id, KEY_LOCKED_COLLAPSED);
}

function reserveBulkLockUnlockToRestore() {
  const startAt = `${Date.now()}-${parseInt(Math.random() * 65000)}`;
  reserveBulkLockUnlockToRestore.lastStartedAt = startAt;
  window.requestAnimationFrame(() => {
    if (reserveBulkLockUnlockToRestore.lastStartedAt != startAt)
      return;

    const toBeLockedTabs   = [...mToBeLockedTabIds];
    const toBeUnlockedTabs = [...mToBeUnlockedTabIds];
    mToBeLockedTabIds.clear();
    mToBeUnlockedTabIds.clear();

    if (toBeLockedTabs.length > 0)
      browser.runtime.sendMessage(TST_ID, {
        type:  'add-tab-state',
        tabs:  toBeLockedTabs,
        state: [KEY_LOCKED_COLLAPSED]
      });
    if (toBeUnlockedTabs.length > 0)
      browser.runtime.sendMessage(TST_ID, {
        type:  'remove-tab-state',
        tabs:  toBeUnlockedTabs,
        state: [KEY_LOCKED_COLLAPSED]
      });
  });
}

browser.tabs.query({}).then(tabs => {
  for (const tab of tabs) {
    restoreLockedState(tab.id);
  }
});
