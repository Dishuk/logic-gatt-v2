import { useCallback, useEffect, useState } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { errorMessage, type Logger } from '@/lib/logger';

const TAG = 'logic-gatt-executor';

/**
 * Holds the screen on while the phone is acting as the peripheral. On by default —
 * a sleeping screen drops the desktop link — but exposed as a toggle for when the
 * phone is charging or the link isn't in use.
 */
export function useScreenAwake(log: Logger) {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    activateKeepAwakeAsync(TAG)
      .then(() => {
        if (active) log.debug('screen kept awake');
      })
      .catch((err) => log.warn(`keep awake: ${errorMessage(err)}`));
    return () => {
      active = false;
      deactivateKeepAwake(TAG).catch(() => {});
    };
  }, [enabled, log]);

  const toggle = useCallback(() => setEnabled((v) => !v), []);

  return { enabled, toggle };
}
