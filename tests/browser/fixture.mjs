import { TemperansCodeblockChild } from "../../src/dashboard/codeblock";
import { abortable } from "../../src/async";
import { healthConnectStagePath } from "../../src/integrations/health-connect";
import { renderNotePathSettings } from "../../src/note-path-settings";
import { Modal, Platform } from 'obsidian';
import { PeerSyncModal } from '../../src/peer-sync/modal';
import { ThirdPartySyncHubModal } from '../../src/integrations/sync-hub-modal';
import { renderAddHabitForm } from '../../src/habit-form';
import { HabitLogModal } from '../../src/modals';
import { HabitDashboardView } from '../../src/dashboard/view';
import { evaluateDailyLog } from '../../src/evaluation';
import { emptyDailyLog } from '../../src/log-schema';
import { todayInZone } from '../../src/date';

const habits = Array.from({ length: 24 }, (_, i) => ({
  id: `habit-${i}`, name: i === 0 ? 'A long habit name for practicing daily concentration' : `Daily habit ${i + 1}`,
  unit: 'minutes', cadence: 'daily', enabled: true, type: i === 1 ? 'session' : 'metric',
  targetHistory: [{ effectiveDate: '2000-01-01', min: 30 }]
}));
const settings = { timezone: 'UTC', habits: [...habits, ...['weekly', 'monthly', 'quarterly', 'annual'].map(cadence => ({
  ...habits[0], id: cadence, name: `${cadence} exercise`, cadence
}))] };
const today = todayInZone(settings.timezone);
const log = emptyDailyLog(today);
const store = {
  folderPath: 'Habit Logs', loadSettings: async () => settings, allLogsForYear: async () => new Map([[today, log]]),
  logsForDates: async (dates, signal) => {
    window.fixtureRangeRequests = [...(window.fixtureRangeRequests || []), [...dates]];
    if (window.holdHistory && dates.length > 1) {
      await abortable(new Promise(resolve => { window.releaseHistory = resolve; }), signal);
    }
    return new Map(dates.includes(today) ? [[today, log]] : []);
  },
  evaluate: evaluateDailyLog, getLog: async () => log, addHabit: async habit => { window.savedHabit = habit; },
  recordMetric: async (date, id, amount, note) => { if (window.failSaves) throw new Error("Simulated save failure"); window.metricWriteCount = (window.metricWriteCount || 0) + 1; window.recordedMetric = { id, amount, note }; return log; },
  addSession: async (date, id, session) => { window.recordedSession = { id, ...session }; return log; }
};
const app = { vault: { getAbstractFileByPath: () => ({}) }, metadataCache: { getFileCache: () => ({ frontmatter: window.fixtureLayout ?? {} }) }, workspace: { layoutReady: true } };
let dashboard;
window.renderFixture = async (kind, options = {}) => {
  window.embeddedChild?.onunload(); window.embeddedChild = undefined;
  window.fixtureRangeRequests = []; window.holdHistory = !!options.holdHistory;
  window.fixtureLayout = options.mode ? { layout: [{ widget: "header" }, { widget: "calendar", mode: options.mode }, { widget: "day-detail" }] } : undefined;
  window.currentLogger?.onClose(); window.currentLogger = undefined;
  window.failSaves = false; window.metricWriteCount = 0;
  window.recordedMetric = window.recordedSession = undefined;
  await dashboard?.onClose();
  dashboard = null;
  document.body.replaceChildren();
  document.body.style.overflow = ""; window.scrollTo(0, 0);
  Platform.isMobileApp = !!options.mobile;
  Platform.isDesktopApp = !options.mobile;
  if (kind === 'note-paths') {
    const pane = document.body.createDiv({ cls: 'temperans-settings' });
    pane.style.cssText = 'width:min(100%,420px);height:100%;overflow:auto;padding:12px';
    const card = pane.createDiv({ cls: 'temperans-subpage-card' });
    window.savedNotePath = { mode: 'flat', format: 'YYYY-MM-DD' };
    renderNotePathSettings(card, app, 'Habit Logs', window.savedNotePath, async value => { window.savedNotePath = value; });
  } else if (kind === 'health') {
    window.healthImported = false;
    window.healthStagingPath = '';
    new ThirdPartySyncHubModal(app, {
      importHealthConnect: async () => { window.healthImported = true; return { imported: 1 }; },
      healthConnectPathControl: () => ({ path: '', defaultPath: 'Habit Logs/.temperance-staging.json', save: async path => {
        window.healthStagingPath = healthConnectStagePath('Habit Logs', path);
      } })
    }).open();
  } else if (kind === 'peer') {
    let plan = Array.from({ length: 20 }, (_, i) => {
      const path = i === 0 ? 'Settings.md' : `2026/09/2026-09-${String(i).padStart(2, '0')}.md`;
      const status = ['different', 'local-only', 'remote-only'][i % 3];
      const descriptor = { path, bytes: 180, sha256: 'fixture' };
      return { path, status, defaultAction: status === 'different' ? 'skip' : status === 'local-only' ? 'upload' : 'download',
        ...(status !== 'remote-only' ? { local: descriptor } : {}), ...(status !== 'local-only' ? { remote: descriptor } : {}) };
    });
    if (options.empty) plan = [];
    const service = {
      isHosting: false, configuredPort: 43887,
      getRemoteProfile: async () => ({ url: 'http://192.168.1.20:43887', secret: 'abcdefghijklmnop' }),
      saveRemoteProfile: async () => {},
      compare: async () => ({ plan }),
      transfer: async (_, actions) => {
        if (window.failPeerTransfer) throw new Error("Connection interrupted");
        window.peerTransfers = Object.fromEntries(actions);
        const results = plan.filter(item => actions.get(item.path) !== 'skip').map(item => ({ path: item.path, action: actions.get(item.path), ok: true, message: 'Transferred' }));
        plan = plan.filter(item => actions.get(item.path) === 'skip');
        return results;
      }
    };
    new PeerSyncModal(app, service).open();
  } else if (kind === 'embed') {
    document.body.style.overflow = 'auto';
    document.body.createDiv().style.height = '2000px';
    const el = document.body.createDiv(); el.style.minHeight = '200px';
    window.embeddedChild = new TemperansCodeblockChild(app, { store, state: { heatmapColor: '#22c55e' } }, JSON.stringify({ widgets: ['day-detail'] }), el);
    await window.embeddedChild.onload();
    window.embedElement = el;
  } else if (kind === 'dashboard') {
    dashboard = new HabitDashboardView({ app }, { store, state: { heatmapColor: '#22c55e' } });
    await dashboard.onOpen();
  } else if (kind === 'log') {
    window.currentLogger = new HabitLogModal(app, store, today, options.habit ? [{ ...habits[0], name: "Practice", ...options.habit }] : habits);
    await window.currentLogger.open();
  } else if (kind === 'settings') {
    const pane = document.body.createDiv({ cls: 'temperans-settings' });
    pane.style.cssText = 'width:min(100%,360px);height:100%;overflow:auto;padding:12px';
    await renderAddHabitForm(pane, store, async () => {});
  } else {
    const modal = new Modal(app);
    modal.modalEl.addClass('temperans-modal', 'temperans-dashboard-actions-modal');
    await renderAddHabitForm(modal.contentEl, store, async () => {});
  }
};
