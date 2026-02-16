/**
 * @fileoverview Grafana Bridge Plugin for Super Productivity.
 * This plugin facilitates real-time and bulk export of task data to a 
 * Grafana/InfluxDB endpoint for advanced productivity analytics.
 * 
 * @version 0.1.0 - Initial Release
 * 
 */

(function () {
    // --- GLOBAL ZOMBIE KILLER PATTERN ---
    const INSTANCE_ID = `grafana_bridge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    window.currentGrafanaInstanceId = INSTANCE_ID;
    console.warn(`[GrafanaBridge] Spawning new instance: ${INSTANCE_ID}`);

    /**
     * Plugin configuration object.
     * @type {{url: string, token: string, measurement: string}}
     */
    let globalConfig = {
        url: '',
        token: '',
        measurement: 'superprod_tasks'
    };

    /** @type {number|null} Timeout ID for debounced task updates. */
    let updateTimeout = null;
    /** @type {Object.<string, string>} Cache for project IDs to titles. */
    let projectsMap = {};
    /** @type {Object.<string, string>} Cache for tag IDs to titles. */
    let tagsMap = {};

    /**
     * Helper for consistent logging with timestamp.
     * @param {string} msg 
     * @param {any} [data] 
     */
    function log(msg, data) {
        const prefix = `[GrafanaBridge] ${new Date().toLocaleTimeString()}`;
        if (data) {
            console.log(`${prefix} ${msg}`, data);
        } else {
            console.log(`${prefix} ${msg}`);
        }
    }

    /**
     * Helper for error logging.
     * @param {string} msg 
     * @param {any} err 
     */
    function logError(msg, err) {
        const prefix = `[GrafanaBridge ERROR] ${new Date().toLocaleTimeString()}`;
        console.error(`${prefix} ${msg}`, err);
    }

    // --- DIRECT GLOBAL MESSAGE HANDLER ---
    async function handleGlobalMessage(event) {
        // ZOMBIE CHECK:
        if (window.currentGrafanaInstanceId !== INSTANCE_ID) return;

        const msg = event.data;
        if (!msg || !msg.type || typeof msg.type !== 'string') return;

        // Filter only our plugin messages
        if (!msg.type.startsWith('PLUGIN_')) return;

        // Clean potentially dirty string
        const cleanType = String(msg.type).trim();

        console.warn(`[GRAFANA_PLUGIN] Processing Message: '${cleanType}' (Instance: ${INSTANCE_ID})`);

        // DEBUG: Force boolean output
        const isTest = (cleanType === 'PLUGIN_TEST_CONNECTION');
        const isSave = (cleanType === 'PLUGIN_SAVE_CONFIG');
        const isImport = (cleanType === 'PLUGIN_IMPORT_HISTORY');
        console.warn(`[GRAFANA_PLUGIN] Flags: Test=${isTest}, Save=${isSave}, Import=${isImport}`);

        // --- EXPLICIT IF BLOCKS (NO ELSE) ---

        if (isSave) {
            console.warn('[GRAFANA_PLUGIN] ENTERING SAVE BLOCK');
            if (msg.config) {
                globalConfig = msg.config;
                if (typeof PluginAPI !== 'undefined') {
                    try {
                        await PluginAPI.persistDataSynced(JSON.stringify(globalConfig));
                        log('Configuration saved by user.');
                        PluginAPI.showSnack({ msg: 'Configuration persisted.', type: 'SUCCESS' });
                    } catch (e) {
                        logError('Failed to persist config', e);
                    }
                }
            }
        }

        if (isTest) {
            console.warn('[GRAFANA_PLUGIN] ENTERING TEST BLOCK');

            // Use config from message if available (so user can test without saving)
            // Fallback to global only if message lacks config properties
            const cfgToTest = (msg.config && msg.config.url) ? msg.config : globalConfig;

            console.warn('[GRAFANA_PLUGIN] About to call testConnection with:', cfgToTest);
            try {
                await testConnection(cfgToTest);
            } catch (e) {
                console.error('[GRAFANA_PLUGIN] Crash inside testConnection invocation', e);
            }
        }

        if (isImport) {
            console.warn('[GRAFANA_PLUGIN] ENTERING IMPORT BLOCK');
            await importAllHistory();
        }
    }

    // Register new listener without removing old one (since we can't reliably).
    // The Zombie Check handles cleanup logic implicitly.
    window.addEventListener('message', handleGlobalMessage);
    console.log('[GrafanaBridge] Global message listener registered.');


    /**
     * Initializes the plugin, loads configuration, and registers lifecycle hooks.
     * @async
     * @returns {Promise<void>}
     */
    async function init() {
        log('Initializing plugin logic...');

        // Load persisted configuration from Super Productivity storage
        const savedData = await PluginAPI.loadSyncedData();
        if (savedData) {
            try {
                globalConfig = JSON.parse(savedData);
                log('Configuration loaded.', globalConfig);
            } catch (e) {
                logError('Failed to parse saved configuration:', e);
            }
        } else {
            log('No native configuration found. Using defaults.');
        }

        // Populate initial caches for projects and tags
        await refreshCache();

        // Register real-time synchronization hooks
        PluginAPI.registerHook('taskComplete', (payload) => {
            log('Hook triggered: taskComplete', payload.taskId);
            syncTask(payload.task);
        });

        PluginAPI.registerHook('currentTaskChange', (payload) => {
            if (payload && payload.current) {
                log('Hook triggered: currentTaskChange', payload.current.id);
                syncTask(payload.current);
            }
        });

        PluginAPI.registerHook('taskUpdate', (payload) => {
            if (updateTimeout) clearTimeout(updateTimeout);
            updateTimeout = setTimeout(() => {
                log('Hook triggered (debounced): taskUpdate', payload.task.id);
                syncTask(payload.task);
            }, 5000);
        });

        PluginAPI.registerHook('taskDelete', (payload) => {
            log('Hook triggered: taskDelete', payload.taskId);
        });

        PluginAPI.registerHook('finishDay', () => {
            log('Hook triggered: finishDay');
            PluginAPI.showSnack({ msg: 'Day concluded. Synchronizing final state.', type: 'INFO' });
        });

        // Explicitly register side panel to ensure view loading
        try {
            PluginAPI.registerSidePanelButton({
                label: 'Grafana Bridge',
                icon: 'extension',
                onClick: () => {
                    PluginAPI.renderPluginView('index.html', { cfg: globalConfig });
                }
            });
            log('Side panel button registered explicitly.');
        } catch (e) {
            // log('Side panel registration skipped (likely handled by manifest), but ensure onClick logic exists.', e);
        }
    }

    /**
     * Refreshes internal caches for project and tag metadata.
     */
    async function refreshCache() {
        try {
            const [projects, tags] = await Promise.all([
                PluginAPI.getAllProjects(),
                PluginAPI.getAllTags()
            ]);
            projectsMap = projects.reduce((acc, p) => ({ ...acc, [p.id]: p.title }), {});
            tagsMap = tags.reduce((acc, t) => ({ ...acc, [t.id]: t.title }), {});
        } catch (e) {
            // logError('Metadata cache refresh failed:', e);
        }
    }

    /**
     * Transforms raw task data into a structured payload for Grafana/InfluxDB.
     */
    function enrichTaskData(task, cfg) {
        const useConfig = cfg || globalConfig;
        const projectName = projectsMap[task.projectId] || 'Unassigned';
        const tagNames = (task.tagIds || []).map(id => tagsMap[id] || id);

        return {
            measurement: useConfig.measurement || 'superprod_tasks',
            tags: {
                project: projectName,
                context: tagNames[0] || 'Default',
                task_id: task.id || 'unknown',
                is_done: String(!!task.isDone)
            },
            fields: {
                duration_ms: (typeof task.timeSpent === 'number') ? task.timeSpent : 0,
                title: task.title || 'Untitled',
                estimate_ms: (typeof task.timeEstimate === 'number') ? task.timeEstimate : 0,
                efficiency_ratio: (task.timeEstimate > 0 && typeof task.timeSpent === 'number') ? (task.timeSpent / task.timeEstimate) : 1
            },
            timestamp: new Date(task.updated || task.created || Date.now()).getTime()
        };
    }

    /**
     * Converts a single data point to InfluxDB Line Protocol.
     */
    function toLineProtocol(item) {
        let ts = item.timestamp;
        if (typeof ts !== 'number' || isNaN(ts)) {
            ts = Date.now();
        }

        const escapeTag = (str) => {
            if (str === null || str === undefined) return '';
            return String(str).replace(/([ ,=])/g, '\\$1');
        };

        const escapeFieldKey = escapeTag;

        const escapeStringField = (str) => {
            return `"${String(str).replace(/"/g, '\\"').replace(/\\/g, '\\\\')}"`;
        };

        const tags = Object.entries(item.tags || {})
            .filter(([_, v]) => v !== null && v !== undefined && v !== '')
            .map(([k, v]) => `${escapeTag(k)}=${escapeTag(v)}`)
            .join(',');

        const fields = Object.entries(item.fields || {})
            .filter(([_, v]) => v !== null && v !== undefined)
            .map(([k, v]) => {
                const cleanKey = escapeFieldKey(k);
                let cleanVal;
                if (typeof v === 'number') {
                    cleanVal = String(v);
                } else if (typeof v === 'boolean') {
                    cleanVal = v ? 'true' : 'false';
                } else {
                    cleanVal = escapeStringField(v);
                }
                return `${cleanKey}=${cleanVal}`;
            })
            .join(',');

        if (!fields) return '';

        const tagPart = tags ? `,${tags}` : '';
        return `${escapeTag(item.measurement)}${tagPart} ${fields} ${ts}`;
    }

    /**
     * Dispatches task data to the configured external endpoint using Line Protocol.
     */
    async function sendToGrafana(payload, cfgOverride) {
        const useConfig = cfgOverride || globalConfig;

        // Check for missing config
        if (!useConfig.url || !useConfig.token) {
            // If explicit override (from test), throw immediately
            if (cfgOverride) {
                throw new Error('Please enter complete URL and Token.');
            }
            log('Sync aborted: External URL or Auth Token is undefined.');
            return;
        }

        let targetUrl = useConfig.url;
        if (!targetUrl.includes('precision=')) {
            const separator = targetUrl.includes('?') ? '&' : '?';
            targetUrl += `${separator}precision=ms`;
        }

        const items = Array.isArray(payload) ? payload : [payload];
        const bodyLines = items.map(toLineProtocol).filter(line => line).join('\n');

        if (!bodyLines) return;

        console.warn('[PAYLOAD PREVIEW]', bodyLines);

        try {
            const response = await fetch(targetUrl, {
                method: 'POST',
                mode: 'cors',
                credentials: 'omit',
                headers: {
                    'Authorization': `Token ${useConfig.token}`,
                    'Content-Type': 'text/plain; charset=utf-8'
                },
                body: bodyLines
            });

            if (!response.ok) {
                let errText = '';
                try {
                    errText = await response.text();
                } catch (readErr) {
                    errText = '(Could not read response body)';
                }
                const cleanErr = errText.length > 500 ? errText.substring(0, 500) + '...' : errText;
                console.error('[GrafanaBridge] Upstream Error:', cleanErr);
                throw new Error(`Upstream error ${response.status} (${response.statusText}): ${cleanErr}`);
            }
            log('Data successfully written to InfluxDB.');
        } catch (e) {
            const errorMsg = e.message || String(e);
            logError('Fetch failed:', e);
            throw new Error(errorMsg);
        }
    }

    /**
     * Synchronizes a single task instance.
     */
    async function syncTask(task) {
        try {
            const enriched = enrichTaskData(task, globalConfig);
            await sendToGrafana(enriched, globalConfig);
        } catch (e) {
            logError('Real-time synchronization error:', e);
        }
    }

    /**
     * Validates the connection by sending a dummy heartbeat payload.
     * Uses the config PASSED from the UI directly.
     */
    async function testConnection(cfgToTest) {
        console.warn('testConnection() called with:', cfgToTest);

        // Validation using the passed config
        if (!cfgToTest || !cfgToTest.url || !cfgToTest.token) {
            const errorMsg = 'Please enter URL and Token first to test connection.';
            logError(errorMsg);
            if (typeof PluginAPI !== 'undefined') {
                PluginAPI.showSnack({ msg: errorMsg, type: 'ERROR' });
            }
            return;
        }

        const now = Date.now();
        const heartbeat = {
            measurement: cfgToTest.measurement || 'superprod_tasks',
            tags: { service: 'grafana-bridge', type: 'heartbeat' },
            fields: { status: 1 },
            timestamp: now
        };

        try {
            await sendToGrafana(heartbeat, cfgToTest);
            log('Connection test passed.');
            if (typeof PluginAPI !== 'undefined') {
                PluginAPI.showSnack({ msg: 'Connection verified successfully.', type: 'SUCCESS' });
            }
        } catch (e) {
            logError('Connection test failed:', e);
            if (typeof PluginAPI !== 'undefined') {
                PluginAPI.showSnack({ msg: `Connection failed: ${e.message}`, type: 'ERROR' });
            }
        }
    }

    /**
     * Orchestrates a bulk import of all historical tasks.
     */
    async function importAllHistory() {
        log('Initiating global historical import...');
        if (typeof PluginAPI !== 'undefined') {
            PluginAPI.showSnack({ msg: 'Initiating global historical import...', type: 'INFO' });
        }

        try {
            await refreshCache();
            const [archived, active] = await Promise.all([
                PluginAPI.getArchivedTasks(),
                PluginAPI.getTasks()
            ]);
            const allTasks = [...archived, ...active];
            const BATCH_SIZE = 50;
            for (let i = 0; i < allTasks.length; i += BATCH_SIZE) {
                const batch = allTasks.slice(i, i + BATCH_SIZE);
                const enrichedBatch = batch.map(t => enrichTaskData(t, globalConfig));
                await sendToGrafana(enrichedBatch, globalConfig);
            }
            if (typeof PluginAPI !== 'undefined') {
                PluginAPI.showSnack({ msg: `Successfully exported ${allTasks.length} items.`, type: 'SUCCESS' });
            }
        } catch (e) {
            if (typeof PluginAPI !== 'undefined') {
                PluginAPI.showSnack({ msg: `Bulk transfer failed: ${e.message}`, type: 'ERROR' });
            }
        }
    }

    // Application instance entry point
    if (typeof PluginAPI !== 'undefined') {
        init();
    } else {
        window.addEventListener('load', init);
    }
})();
