import { mountTabs } from '../shared/work-tabs.js';

mountTabs({
  world: root => import('./app.js').then(m => m.initWorld(root)),
  taiwan: root => import('./taiwan/app.js').then(m => m.initTaiwan(root))
});
