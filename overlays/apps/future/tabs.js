import { mountTabs } from '../shared/work-tabs.js';

mountTabs({
  city: root => import('./city.js').then(m => m.initCity(root)),
  oracle: root => import('./oracle/app.js').then(m => m.initOracle(root))
});
