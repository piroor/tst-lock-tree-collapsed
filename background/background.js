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
        'try-expand-tree-from-long-press-ctrl-key',
        'try-expand-tree-from-end-tab-switch',
        'try-expand-tree-from-focused-collapsed-tab',
        'tab-dblclicked'
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
  }
  catch(_error) {
    // TST is not available
  }
}
registerToTST();

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
          if (configs.blockExpansionFromFocusedParent &&
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
            if (nearestLockedCollapsedAncestor) {
              browser.tabs.update(nearestLockedCollapsedAncestor.id, { active: true });
              return true;
            }
            return false;
          })();

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
          toggleTabLocked(message.tab.id);
          /*
          if (lockedTabs.has(message.tab.id)) {
            browser.runtime.sendMessage(TST_ID, {
              type: 'collapse-tree',
              tab:  message.tab.id
            });
          }
          */
          return Promise.resolve(true);
      }
      break;
  }
});

browser.tabs.onCreated.addListener(tab => {
  restoreLockedState(tab.id);
});

browser.tabs.onRemoved.addListener(tabId => {
  lockedTabs.delete(tabId);
});

async function restoreLockedState(id) {
  const locked = await browser.sessions.getTabValue(id, KEY_LOCKED_COLLAPSED);
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
