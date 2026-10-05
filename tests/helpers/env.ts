import { existsSync } from 'node:fs';
import { which } from '@covi/core';
import { chromium } from 'playwright';

/** Whether the machine can run browser and video tests (they are skipped otherwise). */
export async function canRenderVideo(): Promise<boolean> {
  return Boolean(
    (await which(['ffmpeg'])) && (await which(['ffprobe'])) && (await canUseBrowser()),
  );
}

export async function canUseBrowser(): Promise<boolean> {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

export const fullRenders = process.env.COVI_TEST_RENDER === '1';
