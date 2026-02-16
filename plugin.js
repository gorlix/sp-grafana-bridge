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
                icon: 'M13.985 7.175a4.408 4.408 0 00-.138-.802 5.035 5.035 0 00-1.054-1.998 2.96 2.96 0 00-.366-.393c.198-.787-.245-1.468-.245-1.468-.764-.046-1.237.227-1.42.363-.031-.015-.062-.03-.092-.03-.122-.046-.26-.106-.397-.137-.138-.045-.275-.075-.413-.12-.137-.031-.29-.061-.443-.092-.03 0-.046 0-.076-.015C9.005 1.44 8.058 1 8.058 1 7.004 1.666 6.79 2.604 6.79 2.604s0 .015-.016.06l-.183.046c-.076.03-.168.06-.244.076-.077.03-.168.06-.245.09-.153.076-.32.152-.473.228-.153.09-.306.181-.443.272-.016-.015-.03-.015-.03-.015-1.467-.545-2.766.136-2.766.136-.122 1.544.58 2.528.733 2.71-.03.09-.06.196-.091.287a8.104 8.104 0 00-.245 1.09c0 .06-.015.106-.015.166C1.397 8.386 1 9.748 1 9.748c1.13 1.287 2.46 1.377 2.46 1.377.167.303.366.575.58.848.092.106.183.212.29.318a3.014 3.014 0 00.061 2.149c1.268.045 2.093-.545 2.261-.681.122.045.26.076.382.106.382.106.78.151 1.176.181h.49c.595.848 1.634.954 1.634.954.748-.772.779-1.544.779-1.71v-.015-.03-.03c.153-.107.305-.228.443-.35a5.37 5.37 0 00.779-.892c.015-.03.046-.06.061-.09.84.045 1.436-.515 1.436-.515-.138-.863-.642-1.287-.749-1.378l-.015-.015h-.015s-.015 0-.015-.015c0-.045.015-.106.015-.151 0-.091.015-.182.015-.288V9.4v-.166-.076-.152l-.015-.075c-.015-.091-.03-.197-.061-.288a3.506 3.506 0 00-.428-1.044 3.856 3.856 0 00-.718-.848 3.784 3.784 0 00-.901-.575 3.347 3.347 0 00-.993-.272c-.168-.015-.336-.03-.504-.03H9.37 9.204c-.092.015-.169.015-.26.03-.336.06-.642.181-.932.348-.275.166-.52.363-.718.605a2.579 2.579 0 00-.459.757 2.63 2.63 0 00-.183.817v.393c.015.137.046.273.077.394.076.258.183.485.336.666.137.197.32.348.504.485.183.12.382.212.58.272.199.06.382.076.565.076h.244c.031 0 .047 0 .062-.015.015 0 .046-.015.061-.015.046-.016.076-.016.122-.03l.23-.092a.869.869 0 00.198-.12c.015-.016.03-.03.046-.03a.129.129 0 00.015-.198c-.046-.06-.122-.075-.183-.03-.015.015-.03.015-.046.03-.046.03-.107.046-.168.06l-.183.046c-.03 0-.061.015-.092.015H8.73a1.519 1.519 0 01-.825-.378 1.452 1.452 0 01-.306-.378 1.655 1.655 0 01-.168-.485c-.015-.09-.015-.166-.015-.257v-.106-.03c0-.046.015-.091.015-.136.061-.364.26-.727.55-1 .077-.075.153-.136.23-.181.076-.06.167-.106.259-.151.092-.046.183-.076.29-.106a.993.993 0 01.306-.046h.321c.107.015.229.03.336.046.214.045.427.12.626.242.397.212.733.56.947.969.107.211.183.423.214.65.015.06.015.121.015.167v.363c0 .06-.015.121-.015.182 0 .06-.015.12-.03.181l-.046.182c-.03.121-.077.242-.123.363a3.183 3.183 0 01-.366.666 3.002 3.002 0 01-1.91 1.18c-.122.016-.26.03-.382.046h-.198c-.061 0-.138 0-.199-.015a3.637 3.637 0 01-.81-.151 4.068 4.068 0 01-.748-.303 4.098 4.098 0 01-1.696-1.695 4.398 4.398 0 01-.29-.742c-.076-.257-.107-.514-.137-.772v-.302-.091c0-.136.015-.258.03-.394s.046-.272.061-.393c.03-.137.061-.258.092-.394a5.33 5.33 0 01.275-.741c.214-.47.504-.893.855-1.226.092-.091.184-.167.275-.243.092-.075.184-.136.29-.211a5.39 5.39 0 01.306-.182c.046-.03.107-.045.153-.076a.26.26 0 01.076-.03.26.26 0 01.077-.03c.107-.046.229-.091.336-.121.03-.015.06-.015.091-.03.03-.016.061-.016.092-.03.061-.016.122-.031.168-.046.03-.015.061-.015.092-.015.03 0 .06-.016.091-.016.03 0 .061-.015.092-.015l.046-.015h.046c.03 0 .06-.015.091-.015.03 0 .061-.015.107-.015.03 0 .077-.015.107-.015h.764c.23.015.443.03.657.075.428.076.84.212 1.207.394.366.182.702.393.977.636l.046.045.046.045c.03.03.061.061.107.091l.092.091.091.09c.123.122.23.258.336.394.199.258.367.515.49.772.014.015.014.03.03.046.015.015.015.03.015.045l.046.09.046.092.045.09c.046.122.092.228.123.333.06.167.107.318.137.455.015.045.061.09.122.075a.104.104 0 00.107-.106c.092-.227.092-.393.077-.575z',
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
