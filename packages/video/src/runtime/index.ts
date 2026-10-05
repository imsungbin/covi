import type { CompositionApi, Timeline } from '../timeline/types.ts';
import { Stage } from './stage.ts';

export interface CoviRuntime extends CompositionApi {
  timeline: Timeline;
}

declare global {
  interface Window {
    covi: CoviRuntime;
  }
}

const data = document.getElementById('covi-timeline');
if (!data?.textContent) throw new Error('Missing #covi-timeline');
const timeline = JSON.parse(data.textContent) as Timeline;
const stage = new Stage(document.getElementById('stage')!, timeline);

window.covi = {
  timeline,
  ready: stage.ready,
  seek: (frame: number) => stage.seek(frame),
  layout: () => stage.report(),
};
