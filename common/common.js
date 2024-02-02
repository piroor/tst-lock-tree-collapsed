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
  blockExpansionFromLongPressCtrlKey:     true,
  blockExpansionFromEndTabSwitch:         true,
  blockExpansionFromFocusedCollapsedTab:  true,
  blockExpansionFromExpandCommand:        false,
  blockExpansionFromExpandAllCommand:     false,
  blockCollapsionFromOtherExpansion:      false,
  blockCollapsionFromCollapseCommand:     false,
  blockCollapsionFromCollapseAllCommand:  false,
}, {
  localKeys: [
  ]
});
