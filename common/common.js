/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

import Configs from '/extlib/Configs.js';

export const configs = new Configs({
  context_lockCollapsed: true,
  context_expandExceptLocked: false,
  context_expandAllExceptLocked: false,

  toggleByDblClick: true,
  lockByDefault: false,
  blockExpansionFromFocusedParent:        true,
  blockExpansionFromFocusedBundledParent: true,
  blockExpansionFromAttachedChild:        true,
  redirectChildNotFromExistingTabsUnderLockedCollapsedTree: 'none',
  redirectChildNotFromExistingTabsUnderLockedCollapsedTreeDelayMsec: 100,
  blockExpansionFromLongPressCtrlKey:     true,
  blockExpansionFromEndTabSwitch:         true,
  blockExpansionFromFocusedCollapsedTab:  true,
  blockExpansionFromExpandCommand:        false,
  blockExpansionFromExpandAllCommand:     false,
  blockCollapsionFromOtherExpansion:      false,
  blockCollapsionFromCollapseCommand:     false,
  blockCollapsionFromCollapseAllCommand:  false,

  TSTID: null,

  debug: false,
}, {
  localKeys: [
    'debug',
  ]
});

export async function wait(task = 0, timeout = 0) {
  if (typeof task != 'function') {
    timeout = task;
    task    = null;
  }
  return new Promise((resolve, _reject) => {
    setTimeout(async () => {
      if (task)
        await task();
      resolve();
    }, timeout);
  });
}

export function nextFrame() {
  return new Promise((resolve, _reject) => {
    window.requestAnimationFrame(resolve);
  });
}

export function log(...args)
{
  if (!configs.debug)
    return;

  const message = args.shift();

  args = args.map(arg => typeof arg == 'function' ? arg() : arg);

  const nest = (new Error()).stack.split('\n').length;
  let indent = '';
  for (let i = 0; i < nest; i++) {
    indent += ' ';
  }

  const line = `${indent}${message}`;
  console.log(line, ...args);
}


export const TST_ID = 'treestyletab@piro.sakura.ne.jp';
export const WS_ID  = 'sidebar@waterfox.net';

export async function ensureTSTDetected() {
  try {
    if (await browser.runtime.sendMessage(TST_ID, { type: 'ping' })) {
      configs.TSTID = TST_ID;
      return;
    }
  }
  catch(_error) {
  }
  try {
    if (await browser.runtime.sendMessage(WS_ID, { type: 'ping' })) {
      configs.TSTID = WS_ID;
      return;
    }
  }
  catch(_error) {
  }
  throw new Error('Missing dependency: you need to install Tree Style Tab addon also');
}

export async function callTSTAPI(message) {
  if (!configs.TSTID)
    await ensureTSTDetected();

  try {
    return browser.runtime.sendMessage(configs.TSTID, message);
  }
  catch(error) {
    configs.TSTID = null;
    throw error;
  }
}

export async function getTSTVersion() {
  const version = await callTSTAPI({ type: 'get-version' });
  switch (configs.TSTID) {
    case TST_ID:
      return version;

    case WS_ID:
      // WS 0.1-1.0 are corresponding to TST 4.x
      const majorAndMinor = version.match(/^(\d+)\.(\d+)/);
      return Math.ceil(parseFloat(majorAndMinor)) + 3;
  }
  return 0;
}
