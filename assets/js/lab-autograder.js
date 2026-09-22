(() => {
    'use strict';

    const SUPPORTED_SCHEMAS = new Set(['3cc3-lab-completion-v1', '3de3-lab-completion-v1']);
    const OVERRIDE_PREFIX = 'smrttech:autograder-overrides:v1';
    const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
    const MAX_ARCHIVE_ENTRIES = 500;
    const MAX_COMPLETION_BYTES = 10 * 1024 * 1024;
    const MAX_VERILOG_SOURCE_BYTES = 2 * 1024 * 1024;
    const MAX_PNG_PREVIEW_BYTES = 20 * 1024 * 1024;
    const MAX_TOTAL_PREVIEW_BYTES = 60 * 1024 * 1024;
    // Lab 2 stage 10 is an optional export-only UI stage. Only stages 0-9 are graded.
    const LAB_2_GRADED_STAGE_NUMBERS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const LAB_2_GATE_EXPECTATIONS = Object.freeze({
        'nand-0': '1', 'nand-1': '1', 'nand-2': '1', 'nand-3': '0',
        'xor-0': '0', 'xor-1': '1', 'xor-2': '1', 'xor-3': '0',
        'xnor-0': '1', 'xnor-1': '0', 'xnor-2': '0', 'xnor-3': '1'
    });
    const LAB_2_VERILOG_DIP_IDS = Object.freeze(['verilog-dip-00', 'verilog-dip-01', 'verilog-dip-10', 'verilog-dip-11']);
    const LAB_2_VERILOG_OUTPUTS = Object.freeze(['LED0', 'LED1', 'LED2', 'LED3', 'LED4', 'LED5', 'LED6', 'LED7']);
    const LAB_2_IGNORED_RESPONSE_IDS = new Set([
        'lab2-final-review', 'combinational-analysis',
        'or-0', 'or-1', 'or-2', 'or-3',
        'nor-0', 'nor-1', 'nor-2', 'nor-3',
        ...['or', 'nand', 'nor', 'xor', 'xnor'].flatMap(gate => [0, 1, 2, 3].map(index => `${gate}-led-${index}`))
    ]);
    const reports = [];

    function asArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function text(value) {
        return String(value ?? '').replace(/\s+/g, ' ').trim();
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function round(value) {
        return Math.round((Number(value) || 0) * 100) / 100;
    }

    function labNumber(data) {
        const rawValue = data?.lab?.lab_number ?? data?.lab?.number;
        if (rawValue === null || rawValue === undefined || rawValue === '') return NaN;
        const value = Number(rawValue);
        return Number.isInteger(value) && value >= 1 ? value : NaN;
    }

    function completionPercent(data) {
        if (is3de3Lab2(data)) {
            const checkpoints = gradedCheckpoints(data);
            const completed = checkpoints.filter(checkpointComplete).length;
            return checkpoints.length ? round((completed / LAB_2_GRADED_STAGE_NUMBERS.length) * 100) : null;
        }
        const exportedPercent = data?.lab?.completion_percent;
        if (exportedPercent !== null && exportedPercent !== undefined && exportedPercent !== '' && Number.isFinite(Number(exportedPercent))) {
            return round(exportedPercent);
        }
        const completed = Number(data?.completion?.completed_stages);
        const total = Number(data?.completion?.total_stages);
        return Number.isFinite(completed) && Number.isFinite(total) && total > 0
            ? round((completed / total) * 100)
            : null;
    }

    function normalizedLab(data) {
        if (!data?.lab || typeof data.lab !== 'object') return {};
        const number = labNumber(data);
        const complete = isLabComplete(data);
        return {
            ...data.lab,
            lab_number: Number.isFinite(number) ? number : (data.lab.lab_number ?? data.lab.number),
            lab_title: data.lab.lab_title || data.lab.title,
            completion_status: is3de3Lab2(data) ? (complete ? 'complete' : 'incomplete') : (data.lab.completion_status || data.completion?.status || (complete ? 'complete' : 'incomplete')),
            completion_percent: completionPercent(data),
            export_generated_at: data.lab.export_generated_at || data.generated_at || ''
        };
    }

    function hasValue(value) {
        if (typeof value === 'number') return Number.isFinite(value);
        if (typeof value === 'boolean') return value;
        return text(value) !== '';
    }

    function safeFilenamePart(value) {
        return text(value).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'report';
    }

    function flattenCheckpoints(data) {
        return asArray(data?.checkpoints);
    }

    function is3de3Lab2(data) {
        return data?.schema_version === '3de3-lab-completion-v1' && labNumber(data) === 2;
    }

    function checkpointStage(checkpoint) {
        const rawStage = checkpoint?.stage;
        const explicit = rawStage === null || rawStage === undefined || rawStage === '' ? NaN : Number(rawStage);
        if (Number.isInteger(explicit)) return explicit;
        const match = text(checkpoint?.id).match(/^stage-(\d+)$/i);
        return match ? Number(match[1]) : NaN;
    }

    function checkpointComplete(checkpoint) {
        return checkpoint?.complete === true || checkpoint?.status === 'complete';
    }

    function gradedCheckpoints(data) {
        const checkpoints = flattenCheckpoints(data);
        if (!is3de3Lab2(data)) return checkpoints;
        return checkpoints.filter(checkpoint => LAB_2_GRADED_STAGE_NUMBERS.includes(checkpointStage(checkpoint)));
    }

    function isLabComplete(data) {
        if (is3de3Lab2(data)) {
            const completedStages = new Set(gradedCheckpoints(data).filter(checkpointComplete).map(checkpointStage));
            return LAB_2_GRADED_STAGE_NUMBERS.every(stage => completedStages.has(stage));
        }
        if (data?.schema_version === '3de3-lab-completion-v1') return data.completion?.complete === true;
        return data?.lab?.completion_status === 'complete' && asArray(data?.grading_summary?.missing_required_checkpoints).length === 0;
    }

    function flattenResponses(data) {
        const nested = flattenCheckpoints(data).flatMap(checkpoint =>
            asArray(checkpoint.responses).map(response => ({ checkpoint, response }))
        );
        if (nested.length) return nested;
        const checkpoints = flattenCheckpoints(data);
        return asArray(data?.responses).map(response => ({
            checkpoint: checkpoints.find(checkpoint => checkpoint.id === response.checkpoint_id) || { id: 'responses', title: 'Responses' },
            response: { ...response, id: response.id || response.key, value: response.value, label: response.label || response.key }
        }));
    }

    function responseId(response) {
        return text(response?.id || response?.key);
    }

    function gradedResponses(data) {
        const responses = flattenResponses(data);
        if (!is3de3Lab2(data)) return responses;
        return responses.filter(({ response }) => !LAB_2_IGNORED_RESPONSE_IDS.has(responseId(response)));
    }

    function responseValue(data, id) {
        return flattenResponses(data).find(({ response }) => responseId(response) === id)?.response?.value;
    }

    function flattenChecks(data) {
        return flattenCheckpoints(data).flatMap(checkpoint =>
            asArray(checkpoint.completion_checks).map(check => ({ checkpoint, check }))
        );
    }

    function flattenEvidence(data) {
        const nested = flattenCheckpoints(data).flatMap(checkpoint =>
            asArray(checkpoint.evidence).map(evidence => ({ checkpoint, evidence }))
        );
        if (nested.length) return nested;
        const checkpoints = flattenCheckpoints(data);
        return asArray(data?.evidence).map(evidence => ({
            checkpoint: checkpoints.find(checkpoint => checkpoint.id === evidence.checkpoint_id) || { id: 'evidence', title: 'Evidence' },
            evidence: { ...evidence, id: evidence.id || evidence.key, label: evidence.label || evidence.key, provided: evidence.provided ?? Boolean(evidence.filename) }
        }));
    }

    function evidenceFilename(data, key, submissionPackage = null) {
        const prefix = `evidence/${key.toLowerCase()}-`;
        const packaged = asArray(submissionPackage?.entries).find(entry => text(entry.name).toLowerCase().replace(/\\/g, '/').startsWith(prefix));
        if (packaged) return text(packaged.name).replace(/\\/g, '/').split('/').pop().slice(key.length + 1);
        const record = flattenEvidence(data).find(({ evidence }) => text(evidence.id || evidence.key) === key)?.evidence;
        return text(record?.filename);
    }

    function evidenceProvided(data, key, submissionPackage = null) {
        const filename = evidenceFilename(data, key, submissionPackage);
        const record = flattenEvidence(data).find(({ evidence }) => text(evidence.id || evidence.key) === key)?.evidence;
        return Boolean(filename && (record ? record.provided !== false && record.valid !== false : true));
    }

    function packagedEvidenceEntry(submissionPackage, key) {
        const prefix = `evidence/${key.toLowerCase()}-`;
        return asArray(submissionPackage?.entries).find(entry => text(entry.name).toLowerCase().replace(/\\/g, '/').startsWith(prefix));
    }

    function stripVerilogComments(source) {
        return String(source || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\r\n]*/g, ' ');
    }

    function declarationContains(source, direction, identifier) {
        const pattern = new RegExp(`\\b${direction}\\b([\\s\\S]*?)(?=\\b(?:input|output|inout)\\b|[;)])`, 'gi');
        const identifierPattern = new RegExp(`\\b${identifier}\\b`);
        let match;
        while ((match = pattern.exec(source))) {
            if (identifierPattern.test(match[1])) return true;
        }
        return false;
    }

    function outputHasLogic(source, output) {
        const escaped = output.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const direct = new RegExp(`(?:\\bassign\\s+)?\\b${escaped}\\b\\s*(?:<=|=)`, 'i');
        const primitive = new RegExp(`\\b(?:and|or|not|nand|nor|xor|xnor|buf)\\b(?:\\s+[A-Za-z_$][\\w$]*)?\\s*\\(\\s*${escaped}\\b`, 'i');
        const concatenations = [...source.matchAll(/\bassign\s*\{([^}]*)\}\s*=/gi)];
        return direct.test(source) || primitive.test(source) || concatenations.some(match => new RegExp(`\\b${escaped}\\b`).test(match[1]));
    }

    function lab2VerilogChecks(data, submissionPackage = null) {
        const filename = evidenceFilename(data, 'verilog-file', submissionPackage);
        const packaged = packagedEvidenceEntry(submissionPackage, 'verilog-file');
        const source = typeof packaged?.source_text === 'string' ? stripVerilogComments(packaged.source_text) : '';
        const expectedModule = filename.replace(/\.v$/i, '');
        const moduleMatch = source.match(/\bmodule\s+([A-Za-z_$][\w$]*)\b/i);
        const checks = [
            {
                id: 'verilog-file',
                valid: Boolean(filename) && /\.v$/i.test(filename),
                message: 'The uploaded Verilog design filename must end in .v.',
                filename
            }
        ];
        if (!filename || !/\.v$/i.test(filename)) return checks;
        checks.push({
            id: 'verilog-source-readable',
            valid: Boolean(source),
            message: 'The packaged .v source could not be read. Upload the complete ZIP rather than completion.json by itself.'
        });
        if (!source) return checks;
        checks.push({
            id: 'verilog-module-name',
            valid: moduleMatch?.[1] === expectedModule,
            message: `The Verilog module name must exactly match the filename without .v (${expectedModule}).`,
            expected: expectedModule,
            actual: moduleMatch?.[1] || ''
        });
        ['d1', 'd2'].forEach(input => checks.push({
            id: `verilog-input-${input}`,
            valid: declarationContains(source, 'input', input),
            message: `The Verilog module must declare ${input} as an input.`
        }));
        LAB_2_VERILOG_OUTPUTS.forEach(output => {
            checks.push({
                id: `verilog-output-${output.toLowerCase()}`,
                valid: declarationContains(source, 'output', output),
                message: `The Verilog module must declare ${output} as an output.`
            });
            checks.push({
                id: `verilog-logic-${output.toLowerCase()}`,
                valid: outputHasLogic(source, output),
                message: `The Verilog source must provide logic for ${output}.`
            });
        });
        return checks;
    }

    function lab2CompatibilityChecks(data, submissionPackage = null) {
        const logicElements = text(responseValue(data, 'board-logic-elements'));
        const sensor = text(responseValue(data, 'board-sensor'));
        const projectName = text(responseValue(data, 'quartus-project-name'));
        const verification = text(responseValue(data, 'verilog-verification'));
        const sensorNamesDevice = /adxl\s*-?\s*345/i.test(sensor);
        const sensorDescribesPurpose = /(three|3)[\s-]*axis|acceler|\bx\b.*\by\b.*\bz\b|motion|orientation|tilt|gravity/i.test(sensor);
        const verificationHasCoverage = /00[\s\S]*01[\s\S]*10[\s\S]*11/i.test(verification) || /(?:all|each|every)\s+(?:(?:four|4)\s+)?(?:input\s+)?(?:combinations?|cases?|settings?)/i.test(verification);
        const verificationHasResult = /match|same|identical|pass|worked|correct|differ|mismatch|fail|did\s+not|does\s+not|yes|no/i.test(verification);
        const checks = [
            {
                id: 'board-logic-elements',
                valid: logicElements.replace(/\D/g, '') === '22320',
                message: 'Logic Elements must identify 22,320 logic elements (22320 and 22,320 are both accepted).'
            },
            {
                id: 'board-sensor',
                valid: sensorNamesDevice && sensorDescribesPurpose,
                message: 'On-board sensor must identify the ADXL345 three-axis accelerometer and describe acceleration, X/Y/Z axes, motion, orientation, tilt, or gravity.'
            },
            {
                id: 'quartus-project-name',
                valid: projectName.replace(/\s+/g, '').toLowerCase() === 'lab2',
                message: 'Quartus project name and top-level entity should be Lab2; capitalization differences are accepted.'
            }
        ];
        LAB_2_VERILOG_DIP_IDS.forEach(id => checks.push({
            id,
            valid: text(responseValue(data, id)) !== '',
            message: `${id} must record the observed LED0, LED1, and LED2 states.`
        }));
        checks.push({
            id: 'verilog-circuit-recreated',
            valid: responseValue(data, 'verilog-circuit-recreated') === true,
            message: 'verilog-circuit-recreated must be confirmed.'
        });
        checks.push({
            id: 'output-buffers',
            valid: text(responseValue(data, 'output-buffers')) !== '',
            message: 'output-buffers must be present and non-empty.'
        });
        checks.push({
            id: 'verilog-verification',
            valid: Boolean(verification && verificationHasCoverage && verificationHasResult),
            message: 'verilog-verification must state whether the Verilog implementation matched the earlier schematic for all four input combinations.'
        });
        ['rtl-capture', 'verilog-board'].forEach(id => checks.push({
            id,
            valid: evidenceProvided(data, id, submissionPackage),
            message: `${id} evidence is required.`
        }));
        return [...checks, ...lab2VerilogChecks(data, submissionPackage)];
    }

    function validateLab2Compatibility(data, submissionPackage, errors) {
        const stages = new Set(gradedCheckpoints(data).map(checkpointStage));
        const missingStages = LAB_2_GRADED_STAGE_NUMBERS.filter(stage => !stages.has(stage));
        if (missingStages.length) errors.push(`Lab 2 checkpoint data must contain stages 0 through 9. Missing: ${missingStages.join(', ')}.`);
        const verilogChecks = lab2VerilogChecks(data, submissionPackage);
        const fileCheck = verilogChecks.find(check => check.id === 'verilog-file');
        if (fileCheck.filename && !fileCheck.valid) errors.push(`${fileCheck.message} Received: ${fileCheck.filename}.`);
        if (fileCheck.valid) verilogChecks.filter(check => check.id !== 'verilog-file' && !check.valid).forEach(check => errors.push(check.message));
    }

    function validateCompletion(data, options = {}) {
        const errors = [];
        const warnings = [];
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return { valid: false, errors: ['Completion file must contain a JSON object.'], warnings };
        }
        const is3de3 = data.schema_version === '3de3-lab-completion-v1';
        if (!SUPPORTED_SCHEMAS.has(data.schema_version)) errors.push('Unsupported schema version. Expected a 3CC3 or 3DE3 lab completion export.');
        if (!data.lab || typeof data.lab !== 'object') errors.push('Lab metadata is missing.');
        if (!Number.isFinite(labNumber(data))) errors.push('Lab number is missing or invalid.');
        if (!text(data.lab?.lab_title || data.lab?.title)) errors.push('Lab title is missing.');
        if (!data.student || typeof data.student !== 'object') errors.push('Student metadata is missing.');
        if (!is3de3 && (!data.grading_summary || typeof data.grading_summary !== 'object')) errors.push('Grading summary is missing.');
        if (!Array.isArray(data.checkpoints)) errors.push('Checkpoint data is missing.');
        if (is3de3) {
            if (!data.completion || typeof data.completion !== 'object') errors.push('Completion state is missing.');
        } else {
            if (!text(data.lab?.completion_status)) errors.push('Completion status is missing.');
            if (!Number.isFinite(Number(data.grading_summary?.total_required_checkpoints))) errors.push('Total required checkpoint count is missing.');
            if (!Number.isFinite(Number(data.grading_summary?.completed_required_checkpoints))) errors.push('Completed required checkpoint count is missing.');
            if (!Array.isArray(data.grading_summary?.missing_required_checkpoints)) errors.push('Missing required checkpoint list is missing.');
        }

        if (is3de3Lab2(data) && Array.isArray(data.checkpoints)) validateLab2Compatibility(data, options.submission_package, errors);

        if (!text(data.student?.name_or_team || data.student?.student_names)) warnings.push('Student or team identity is missing.');
        if (!text(data.student?.student_numbers) && !text(data.student?.group_number)) warnings.push('Student number(s) or group number is missing.');
        if (!data.integrity_notice) warnings.push('Integrity notice is missing from the export.');
        return { valid: errors.length === 0, errors, warnings };
    }

    async function sha256(value) {
        if (!globalThis.crypto?.subtle || !globalThis.TextEncoder) return '';
        try {
            const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
            return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        } catch {
            return '';
        }
    }

    async function verifyExportHash(data) {
        if (!text(data?.export_hash)) {
            return { status: 'not_present', message: 'No export hash is present in this file.' };
        }
        if (data.export_hash_algorithm !== 'SHA-256' || data.export_hash_scope !== 'JSON content excluding the export_hash fields.') {
            return { status: 'not_verified', message: 'The export hash metadata uses an unsupported format.' };
        }
        if (!globalThis.crypto?.subtle) {
            return { status: 'not_verified', message: 'Web Crypto is unavailable in this browser.' };
        }

        const hashPayload = { ...data };
        delete hashPayload.export_hash;
        delete hashPayload.export_hash_algorithm;
        delete hashPayload.export_hash_scope;
        const computed = await sha256(JSON.stringify(hashPayload));
        if (!computed) return { status: 'not_verified', message: 'The hash could not be computed in this browser.' };
        return computed === data.export_hash
            ? { status: 'matched', message: 'Hash matched the exported completion record.', computed_hash: computed }
            : { status: 'mismatch', message: 'Hash mismatch. The file may have changed after export.', computed_hash: computed };
    }

    function categoryResult(category, earned, explanation, details = {}) {
        return {
            id: category.id,
            label: category.label,
            method: category.method,
            points_earned: round(clamp(earned, 0, category.points)),
            points_possible: category.points,
            explanation,
            details
        };
    }

    function scoreCompletion(category, data) {
        const summary = data.grading_summary || {};
        if (data.schema_version === '3de3-lab-completion-v1') {
            const required = gradedCheckpoints(data).filter(checkpoint => checkpoint.required !== false);
            const completed = required.filter(checkpointComplete).length;
            return categoryResult(category, category.points * (required.length ? completed / required.length : 0), `${completed}/${required.length} required checkpoints are complete.`, { completed, total: required.length });
        }
        const total = Number(summary.total_required_checkpoints);
        const completed = Number(summary.completed_required_checkpoints);
        const fallback = flattenCheckpoints(data).filter(checkpoint => checkpoint.required);
        const denominator = Number.isFinite(total) && total > 0 ? total : fallback.length;
        const numerator = Number.isFinite(completed) ? completed : fallback.filter(checkpoint => checkpoint.status === 'complete').length;
        const ratio = denominator ? clamp(numerator / denominator, 0, 1) : 0;
        return categoryResult(category, category.points * ratio, `${numerator}/${denominator} required checkpoints are complete.`, { completed: numerator, total: denominator });
    }

    function scoreAutoChecks(category, data) {
        const checks = flattenChecks(data).filter(({ check }) => ['knowledge_check', 'ordering_check'].includes(check.type));
        if (!checks.length) {
            return categoryResult(category, category.points, 'No separately auto-graded knowledge or ordering checks were recorded.', { passed: 0, total: 0 });
        }
        const knowledgeChecks = checks.filter(({ check }) => check.type === 'knowledge_check');
        const orderingChecks = checks.filter(({ check }) => check.type === 'ordering_check');
        const passedKnowledge = knowledgeChecks.filter(({ check }) => check.complete === true).length;
        const passed = passedKnowledge + orderingChecks.length;
        const explanation = orderingChecks.length
            ? `${passedKnowledge}/${knowledgeChecks.length} knowledge checks passed; ${orderingChecks.length} sensing-chain ordering activit${orderingChecks.length === 1 ? 'y was' : 'ies were'} accepted from the completed submission.`
            : `${passedKnowledge}/${knowledgeChecks.length} knowledge checks passed.`;
        return categoryResult(category, category.points * (passed / checks.length), explanation, {
            passed,
            total: checks.length,
            knowledge_checks_passed: passedKnowledge,
            knowledge_checks_total: knowledgeChecks.length,
            ordering_checks_assumed_correct: orderingChecks.length
        });
    }

    function scoreResponsePresence(category, data) {
        const responseIds = asArray(category.response_ids);
        let candidates = gradedResponses(data).filter(({ response }) => !['checkbox', 'choice'].includes(response.type));
        if (responseIds.length) {
            candidates = responseIds.map(id => candidates.find(item => item.response.id === id) || {
                checkpoint: { id: 'unrecorded', title: 'Unrecorded response' },
                response: { id, label: id, value: '', type: 'number', validation: { status: 'fail' } }
            });
        }
        if (!candidates.length) {
            return categoryResult(category, category.points, 'No measurable response fields were available for this category.', { recorded: 0, total: 0 });
        }
        const quality = candidates.reduce((total, { response }) => {
            if (!hasValue(response.value)) return total;
            if (response.type === 'number' && !Number.isFinite(Number(response.value))) return total;
            if (response.validation?.status === 'fail') return total;
            return total + (response.validation?.status === 'warning' ? 0.5 : 1);
        }, 0);
        return categoryResult(category, category.points * (quality / candidates.length), `${round(quality)}/${candidates.length} expected responses are present and usable.`, {
            recorded_quality: round(quality),
            total: candidates.length,
            response_ids: candidates.map(item => item.response.id)
        });
    }

    function scoreValidation(category, data, integrity) {
        const responses = gradedResponses(data).map(item => item.response);
        const flags = asArray(data.grading_summary?.potential_mark_loss_flags);
        const fails = responses.filter(response => response.validation?.status === 'fail').length;
        const warnings = responses.filter(response => response.validation?.status === 'warning').length;
        const highFlags = flags.filter(flag => /high|error|fail/i.test(flag.severity)).length;
        const warningFlags = flags.filter(flag => !/high|error|fail/i.test(flag.severity)).length;
        const deductionRatio = (fails * 0.35) + (warnings * 0.15) + (highFlags * 0.35) + (warningFlags * 0.05) + (integrity.status === 'mismatch' ? 0.35 : 0);
        const score = category.points * (1 - clamp(deductionRatio, 0, 1));
        const explanation = integrity.status === 'mismatch'
            ? 'Validation score includes a deduction for a hash mismatch.'
            : `${fails} failures, ${warnings} warnings, and ${flags.length} exported mark-loss flags were recorded.`;
        return categoryResult(category, score, explanation, { fails, warnings, high_flags: highFlags, warning_flags: warningFlags });
    }

    function scoreLab2GateOutputs(category, data) {
        const results = Object.entries(LAB_2_GATE_EXPECTATIONS).map(([id, expected]) => {
            const actual = text(responseValue(data, id));
            return { id, expected, actual, correct: actual === expected };
        });
        const correct = results.filter(result => result.correct).length;
        return categoryResult(category, category.points * (correct / results.length), `${correct}/${results.length} required NAND, XOR, and XNOR F outputs are correct.`, {
            correct,
            total: results.length,
            results
        });
    }

    function scoreLab2Validation(category, data, submissionPackage) {
        const checks = lab2CompatibilityChecks(data, submissionPackage);
        const passed = checks.filter(check => check.valid).length;
        return categoryResult(category, category.points * (passed / checks.length), `${passed}/${checks.length} Lab 2 reference, project-name, and Verilog-file checks passed.`, {
            passed,
            total: checks.length,
            checks
        });
    }

    function scoreSubmissionReadiness(category, data, integrity) {
        const summary = data.grading_summary || {};
        const student = data.student || {};
        const required = gradedCheckpoints(data).filter(checkpoint => checkpoint.required);
        const finalCheckpoint = required.at(-1);
        const identity = Boolean(text(student.name_or_team || student.student_names) && (text(student.student_numbers) || text(student.group_number)));
        const complete = isLabComplete(data);
        const finalReady = checkpointComplete(finalCheckpoint);
        const hashPresent = integrity.status === 'matched' || integrity.status === 'not_present' ? Boolean(text(data.export_hash)) : integrity.status === 'not_verified';
        const parts = [identity, complete, finalReady, hashPresent];
        const score = category.points * (parts.filter(Boolean).length / parts.length);
        return categoryResult(category, score, 'Readiness checks identity, completion status, final checkpoint, and export hash availability.', {
            identity_present: identity,
            lab_complete: complete,
            final_checkpoint_complete: Boolean(finalReady),
            hash_present_or_verified: hashPresent
        });
    }

    function scoreReflectionEvidence(category, data) {
        const reflections = asArray(data.reflection);
        const evidence = flattenEvidence(data);
        const relevant = [];
        reflections.forEach(item => relevant.push(text(item.answer).length >= 12));
        evidence.forEach(({ evidence: item }) => relevant.push(item.provided === true));
        if (!relevant.length) {
            return categoryResult(category, category.points, 'No reflection or evidence requirement can be inferred from this export; this point is provisionally awarded.', { inferred_requirements: 0 });
        }
        const complete = relevant.filter(Boolean).length;
        return categoryResult(category, category.points * (complete / relevant.length), `${complete}/${relevant.length} reflection or evidence items are present.`, { complete, total: relevant.length });
    }

    function scoreCategory(category, data, integrity, submissionPackage = null) {
        if (category.method === 'required_checkpoints_complete') return scoreCompletion(category, data);
        if (category.method === 'knowledge_check_pass_rate' || category.method === 'auto_check_pass_rate') return scoreAutoChecks(category, data);
        if (category.method === 'lab2_gate_outputs') return scoreLab2GateOutputs(category, data);
        if (category.method === 'lab2_validation_quality') return scoreLab2Validation(category, data, submissionPackage);
        if (category.method === 'required_response_presence' || category.method === 'response_presence') return scoreResponsePresence(category, data);
        if (category.method === 'validation_statuses' || category.method === 'validation_quality') return scoreValidation(category, data, integrity);
        if (category.method === 'final_checkpoint_completion' || category.method === 'submission_readiness') return scoreSubmissionReadiness(category, data, integrity);
        if (category.method === 'reflection_evidence') return scoreReflectionEvidence(category, data);
        return categoryResult(category, 0, 'No scoring method is configured for this category.');
    }

    function addReviewItem(items, item) {
        const key = [item.type, item.checkpoint_id, item.field_id, item.message].join('|');
        if (!items.some(existing => existing.key === key)) items.push({ ...item, key });
    }

    function collectReviewItems(data, validation, integrity, submissionPackage = null) {
        const items = [];
        validation.errors.forEach(message => addReviewItem(items, { category: 'semi_automatic', severity: 'high', type: 'invalid_file', message }));
        validation.warnings.forEach(message => addReviewItem(items, { category: 'semi_automatic', severity: 'warning', type: 'metadata', message }));
        if (integrity.status === 'mismatch') addReviewItem(items, { category: 'semi_automatic', severity: 'high', type: 'hash_mismatch', message: integrity.message });
        if (integrity.status === 'not_verified') addReviewItem(items, { category: 'semi_automatic', severity: 'warning', type: 'hash_not_verified', message: integrity.message });

        if (is3de3Lab2(data)) {
            lab2CompatibilityChecks(data, submissionPackage).filter(check => !check.valid).forEach(check => {
                addReviewItem(items, {
                    category: 'semi_automatic', severity: 'warning', type: 'lab2_compatibility', field_id: check.id,
                    message: check.message
                });
            });
            Object.entries(LAB_2_GATE_EXPECTATIONS).forEach(([id, expected]) => {
                const actual = text(responseValue(data, id));
                if (actual !== expected) {
                    addReviewItem(items, {
                        category: 'semi_automatic', severity: 'warning', type: 'lab2_gate_output', field_id: id,
                        message: `${id.toUpperCase()} should be ${expected}; received ${actual || 'no response'}.`
                    });
                }
            });
        }

        asArray(data.grading_summary?.potential_mark_loss_flags).forEach(flag => {
            addReviewItem(items, {
                category: 'semi_automatic',
                severity: /high|error|fail/i.test(flag.severity) ? 'high' : 'warning',
                type: 'exported_mark_loss_flag',
                checkpoint_id: flag.checkpoint_id || '',
                field_id: flag.field_id || '',
                message: flag.message || 'Exported mark-loss flag requires review.'
            });
        });

        gradedCheckpoints(data).filter(checkpoint => checkpoint.required !== false && !checkpointComplete(checkpoint)).forEach(checkpoint => {
            addReviewItem(items, {
                category: 'semi_automatic', severity: 'warning', type: 'incomplete_checkpoint', checkpoint_id: checkpoint.id,
                message: `Required checkpoint is incomplete: ${checkpoint.title || checkpoint.id}.`
            });
        });

        gradedResponses(data).forEach(({ checkpoint, response }) => {
            const validationStatus = response.validation?.status;
            if (validationStatus === 'not_checked') {
                addReviewItem(items, {
                    category: 'instructor_review', severity: 'review', type: 'not_checked_response', checkpoint_id: checkpoint.id,
                    field_id: response.id, message: `${response.label || response.id} requires instructor review.`
                });
            }
            if (response.type === 'text' && text(response.value)) {
                addReviewItem(items, {
                    category: 'instructor_review', severity: 'review', type: 'free_text_response', checkpoint_id: checkpoint.id,
                    field_id: response.id, message: `${response.label || response.id} is a free-text response.`
                });
            }
            if (response.type === 'number' && hasValue(response.value) && (!Number.isFinite(Number(response.value)) || Math.abs(Number(response.value)) > 10000000)) {
                addReviewItem(items, {
                    category: 'semi_automatic', severity: 'warning', type: 'suspicious_numeric_value', checkpoint_id: checkpoint.id,
                    field_id: response.id, message: `${response.label || response.id} has a suspicious numeric value.`
                });
            }
        });

        flattenEvidence(data).filter(({ evidence }) => evidence.provided !== true).forEach(({ checkpoint, evidence }) => {
            addReviewItem(items, {
                category: 'instructor_review', severity: 'review', type: 'missing_evidence', checkpoint_id: checkpoint.id,
                field_id: evidence.id, message: `${evidence.label || evidence.id} was not provided.`
            });
        });

        asArray(data.reflection).forEach((reflection, index) => {
            if (text(reflection.answer).length < 12) {
                addReviewItem(items, {
                    category: 'instructor_review', severity: 'review', type: 'incomplete_reflection', field_id: `reflection-${index + 1}`,
                    message: `Reflection answer ${index + 1} is missing or too short.`
                });
            }
        });
        return items;
    }

    function reportStatus(data, validation, integrity, reviewItems) {
        if (!validation.valid) return 'Invalid file';
        if (integrity.status === 'mismatch') return 'Hash mismatch';
        if (!isLabComplete(data)) return 'Incomplete';
        if (reviewItems.length) return 'Instructor review needed';
        return 'Ready for gradebook';
    }

    function baseOverrideKey(data, fileName) {
        const lab = labNumber(data) || 'unknown';
        const student = data.student?.student_numbers || data.student?.name_or_team || fileName || 'unknown';
        return `${lab}:${safeFilenamePart(student)}`;
    }

    function readOverride(key) {
        try {
            return JSON.parse(localStorage.getItem(`${OVERRIDE_PREFIX}:${key}`) || '{}');
        } catch {
            return {};
        }
    }

    async function gradeCompletion(data, options = {}) {
        const validation = validateCompletion(data, options);
        const integrity = await verifyExportHash(data || {});
        const currentLabNumber = labNumber(data);
        const rules = data?.schema_version === '3de3-lab-completion-v1'
            ? globalThis.LAB_GRADING_RULES?.['3de3']?.[currentLabNumber] || globalThis.LAB_GRADING_RULES?.generic
            : globalThis.LAB_GRADING_RULES?.[currentLabNumber] || globalThis.LAB_GRADING_RULES?.generic;
        const categories = validation.valid && rules
            ? rules.categories.map(category => scoreCategory(category, data, integrity, options.submission_package))
            : [];
        const autogradedScore = round(categories.reduce((sum, category) => sum + category.points_earned, 0));
        const possibleScore = round(categories.reduce((sum, category) => sum + category.points_possible, 0));
        const reviewItems = collectReviewItems(data || {}, validation, integrity, options.submission_package);
        const overrideKey = baseOverrideKey(data || {}, options.file_name || '');
        const override = readOverride(overrideKey);
        const status = reportStatus(data || {}, validation, integrity, reviewItems);
        return {
            report_version: 'smrttech-autograder-v1',
            generated_at: new Date().toISOString(),
            file_name: options.file_name || 'uploaded-completion.json',
            submission_package: options.submission_package || null,
            source_data: data,
            schema_validation: validation,
            integrity,
            lab: normalizedLab(data),
            student: data?.student ? { ...data.student, name_or_team: data.student.name_or_team || data.student.student_names, instructor_or_ta: data.student.instructor_or_ta || data.student.instructor } : {},
            grading_rule_set: rules?.id || 'unavailable',
            generic_rules_applied: Boolean(rules?.generic),
            categories,
            autograded_score: autogradedScore,
            possible_score: possibleScore,
            percentage: possibleScore ? round((autogradedScore / possibleScore) * 100) : 0,
            review_items: reviewItems,
            instructor_review_required: reviewItems.length > 0,
            status,
            override_key: overrideKey,
            override: {
                manual_adjustment: Number(override.manual_adjustment) || 0,
                instructor_comment: text(override.instructor_comment),
                final_approved_score: override.final_approved_score === '' || override.final_approved_score === undefined
                    ? null
                    : Number(override.final_approved_score)
            }
        };
    }

    function finalScore(report) {
        const approved = report.override?.final_approved_score;
        if (Number.isFinite(approved)) return round(clamp(approved, 0, report.possible_score));
        return round(clamp(report.autograded_score + (Number(report.override?.manual_adjustment) || 0), 0, report.possible_score));
    }

    function csvEscape(value) {
        const string = value === null || value === undefined ? '' : String(value);
        return /[",\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string;
    }

    function reportToGradebookRow(report) {
        const data = report.source_data || {};
        const warnings = report.review_items.filter(item => item.severity === 'warning' || item.severity === 'review').length;
        const high = report.review_items.filter(item => item.severity === 'high').length;
        return {
            file_name: report.file_name,
            schema_version: data.schema_version || '',
            lab_number: report.lab.lab_number || '',
            lab_title: report.lab.lab_title || '',
            student_name_or_team: report.student.name_or_team || '',
            student_numbers: report.student.student_numbers || '',
            group_number: report.student.group_number || '',
            lab_section: report.student.lab_section || '',
            instructor_or_ta: report.student.instructor_or_ta || '',
            completion_status: report.lab.completion_status || (data.completion?.complete ? 'complete' : 'incomplete'),
            completion_percent: report.lab.completion_percent ?? (data.completion?.total_stages ? round((data.completion.completed_stages / data.completion.total_stages) * 100) : ''),
            hash_status: report.integrity.status,
            autograded_score: report.autograded_score,
            possible_score: report.possible_score,
            percentage: report.percentage,
            grading_rule_set: report.grading_rule_set,
            instructor_review_required: report.instructor_review_required ? 'yes' : 'no',
            high_severity_flags: high,
            warning_flags: warnings,
            missing_required_checkpoints: asArray(data.grading_summary?.missing_required_checkpoints).map(item => item.title || item.id || item).join(' | ') || asArray(data.checkpoints).filter(item => item.required !== false && item.complete !== true && item.status !== 'complete').map(item => item.title || item.id).join(' | '),
            manual_adjustment: report.override.manual_adjustment,
            instructor_comment: report.override.instructor_comment,
            final_approved_score: report.override.final_approved_score ?? '',
            final_score: finalScore(report),
            generated_at: report.generated_at,
            exported_at: report.lab.export_generated_at || ''
        };
    }

    function gradebookCsv(items) {
        const rows = items.map(reportToGradebookRow);
        const columns = [
            'file_name', 'schema_version', 'lab_number', 'lab_title', 'student_name_or_team', 'student_numbers', 'group_number',
            'lab_section', 'instructor_or_ta', 'completion_status', 'completion_percent', 'hash_status', 'autograded_score',
            'possible_score', 'percentage', 'grading_rule_set', 'instructor_review_required', 'high_severity_flags', 'warning_flags',
            'missing_required_checkpoints', 'manual_adjustment', 'instructor_comment', 'final_approved_score', 'final_score', 'generated_at', 'exported_at'
        ];
        return [columns.join(','), ...rows.map(row => columns.map(column => csvEscape(row[column])).join(','))].join('\r\n');
    }

    function downloadBlob(content, filename, type) {
        const blob = new Blob([content], { type });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
    }

    function formatDate(value) {
        if (!value) return 'Not recorded';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    }

    function createElement(tag, className, content) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (content !== undefined && content !== null) element.textContent = content;
        return element;
    }

    function createBadge(value) {
        const className = value === 'Ready for gradebook' || value === 'matched'
            ? 'is-ready'
            : value === 'Hash mismatch' || value === 'Invalid file'
                ? 'is-high'
                : value === 'Incomplete'
                    ? 'is-incomplete'
                    : 'is-review';
        return createElement('span', `autograder-badge ${className}`, value);
    }

    function appendCell(row, value, className) {
        const cell = createElement('td', className || '', value);
        row.appendChild(cell);
    }

    function appendHeader(row, value) {
        const cell = createElement('th', '', value);
        cell.scope = 'col';
        row.appendChild(cell);
    }

    function detailTable(className, headings, rows) {
        const wrapper = createElement('div', 'autograder-table-wrap');
        const table = createElement('table', `autograder-table ${className || ''}`);
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        headings.forEach(heading => appendHeader(headRow, heading));
        head.appendChild(headRow);
        table.appendChild(head);
        const body = document.createElement('tbody');
        rows.forEach(row => body.appendChild(row));
        table.appendChild(body);
        wrapper.appendChild(table);
        return wrapper;
    }

    function renderCategories(report) {
        const rows = report.categories.map(category => {
            const row = document.createElement('tr');
            appendCell(row, category.label);
            appendCell(row, `${category.points_earned}/${category.points_possible}`, 'numeric');
            appendCell(row, category.explanation);
            return row;
        });
        return detailTable('autograder-category-table', ['Category', 'Score', 'Explanation'], rows);
    }

    function renderCheckpoints(report) {
        const rows = gradedCheckpoints(report.source_data).map(checkpoint => {
            const row = document.createElement('tr');
            appendCell(row, checkpoint.title || checkpoint.id);
            appendCell(row, checkpoint.required ? 'Yes' : 'No');
            appendCell(row, checkpoint.status || (checkpoint.complete === true ? 'complete' : 'not_started'));
            appendCell(row, formatDate(checkpoint.completed_at));
            appendCell(row, String(asArray(checkpoint.responses).length));
            const problems = asArray(checkpoint.responses).filter(response => ['warning', 'fail'].includes(response.validation?.status)).length;
            appendCell(row, String(problems));
            return row;
        });
        return detailTable('autograder-checkpoint-table', ['Checkpoint', 'Required', 'Status', 'Completed', 'Responses', 'Warnings/fails'], rows);
    }

    function renderReviewItems(report) {
        if (!report.review_items.length) return createElement('p', 'autograder-empty-detail', 'No instructor-review items were generated.');
        const rows = report.review_items.map(item => {
            const row = document.createElement('tr');
            appendCell(row, item.severity);
            appendCell(row, item.checkpoint_id || 'General');
            appendCell(row, item.field_id || '');
            appendCell(row, item.message);
            return row;
        });
        return detailTable('autograder-review-table', ['Severity', 'Checkpoint', 'Field', 'Review item'], rows);
    }

    function instructorTextResponses(data) {
        return gradedResponses(data).filter(({ response }) => response.type === 'text');
    }

    function renderInstructorTextResponses(report) {
        const responses = instructorTextResponses(report.source_data);
        if (!responses.length) return createElement('p', 'autograder-empty-detail', 'No free-form textbox responses were recorded in this submission.');
        const introduction = createElement('p', 'autograder-written-review-note', 'These student-written responses always require instructor review. Autograded questions and structured inputs are excluded.');
        const rows = responses.map(({ checkpoint, response }) => {
            const row = document.createElement('tr');
            appendCell(row, checkpoint.title || checkpoint.id);
            appendCell(row, response.label || response.id);
            appendCell(row, response.display_value ?? response.value ?? '');
            return row;
        });
        const wrapper = createElement('div', 'autograder-written-review');
        wrapper.append(introduction, detailTable('autograder-written-response-table', ['Checkpoint', 'Question', 'Response'], rows));
        return wrapper;
    }

    function renderResponses(report) {
        const rows = gradedResponses(report.source_data).map(({ checkpoint, response }) => {
            const row = document.createElement('tr');
            appendCell(row, checkpoint.title || checkpoint.id);
            appendCell(row, response.label || response.id);
            appendCell(row, response.display_value ?? response.value ?? '');
            appendCell(row, response.unit || '');
            appendCell(row, response.validation?.status || 'not_checked');
            appendCell(row, response.validation?.message || '');
            return row;
        });
        return detailTable('autograder-response-table', ['Checkpoint', 'Response', 'Value', 'Unit', 'Validation', 'Message'], rows);
    }

    function formatBytes(value) {
        const bytes = Number(value) || 0;
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${round(bytes / 1024)} KB`;
        return `${round(bytes / (1024 * 1024))} MB`;
    }

    function renderPackageContents(report) {
        const submission = report.submission_package;
        if (!submission) return createElement('p', 'autograder-empty-detail', 'Package contents are unavailable for this file.');
        const meta = createElement('p', 'autograder-package-meta', `${submission.format} input | completion record: ${submission.completion_entry || 'not found'} | ${submission.entry_count} file${submission.entry_count === 1 ? '' : 's'}`);
        const rows = asArray(submission.entries).map(entry => {
            const row = document.createElement('tr');
            appendCell(row, entry.role);
            appendCell(row, entry.name, 'autograder-package-name');
            appendCell(row, entry.type);
            appendCell(row, formatBytes(entry.size_bytes), 'numeric');
            const previewCell = createElement('td', 'autograder-package-preview');
            if (entry.preview_url) {
                const details = document.createElement('details');
                details.className = 'autograder-image-preview';
                details.appendChild(createElement('summary', '', 'View PNG'));
                const image = document.createElement('img');
                image.src = entry.preview_url;
                image.alt = `PNG evidence preview: ${entry.name}`;
                image.loading = 'lazy';
                const openFull = createElement('a', 'autograder-preview-link', 'Open full size');
                openFull.href = entry.preview_url;
                openFull.target = '_blank';
                openFull.rel = 'noopener';
                details.append(image, openFull);
                previewCell.appendChild(details);
            } else if (entry.preview_error) {
                previewCell.textContent = entry.preview_error;
            } else {
                previewCell.textContent = entry.type === 'PNG image' ? 'Preview unavailable' : '—';
            }
            row.appendChild(previewCell);
            return row;
        });
        const wrapper = createElement('div', 'autograder-package-content');
        wrapper.append(meta, detailTable('autograder-package-table', ['Role', 'File', 'Type', 'Size', 'Preview'], rows));
        return wrapper;
    }

    function updateOverride(report, field, value) {
        report.override[field] = field === 'instructor_comment' ? value : (value === '' ? null : Number(value));
        if (field === 'manual_adjustment' && report.override[field] === null) report.override[field] = 0;
        localStorage.setItem(`${OVERRIDE_PREFIX}:${report.override_key}`, JSON.stringify(report.override));
        renderResults();
    }

    function overrideField(report, labelText, field, type, step) {
        const label = createElement('label', 'autograder-override-field');
        label.append(createElement('span', '', labelText));
        const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
        if (type !== 'textarea') {
            input.type = type;
            if (step) input.step = step;
        }
        input.value = report.override[field] ?? '';
        input.addEventListener('change', () => updateOverride(report, field, input.value));
        label.appendChild(input);
        return label;
    }

    function renderReport(report) {
        const card = createElement('article', 'autograder-report-card');
        const heading = createElement('div', 'autograder-report-heading');
        const identity = createElement('div');
        identity.append(createElement('p', 'autograder-report-eyebrow', `Lab ${report.lab.lab_number || 'unknown'} completion`));
        identity.append(createElement('h2', 'autograder-report-title', report.student.name_or_team || 'Unidentified student or team'));
        identity.append(createElement('p', 'autograder-report-meta', `${report.student.student_numbers || report.student.group_number || 'No student number or group'} | ${report.student.lab_section || 'No lab section'} | ${report.file_name}`));
        heading.append(identity, createBadge(report.status));
        card.appendChild(heading);

        const statGrid = createElement('div', 'autograder-stat-grid');
        [
            ['Autograded score', `${report.autograded_score}/${report.possible_score}`],
            ['Current score', `${finalScore(report)}/${report.possible_score}`],
            ['Completion', `${report.lab.completion_percent ?? 'Unknown'}%`],
            ['Integrity', report.integrity.status.replace(/_/g, ' ')],
            ['Exported', formatDate(report.lab.export_generated_at)],
            ['Rule set', report.grading_rule_set]
        ].forEach(([label, value]) => {
            const stat = createElement('div', 'autograder-stat');
            stat.append(createElement('span', '', label), createElement('strong', '', value));
            statGrid.appendChild(stat);
        });
        card.appendChild(statGrid);

        if (report.generic_rules_applied) card.append(createElement('p', 'autograder-rule-note', 'Generic grading rules applied. Instructor should confirm the final rubric.'));
        if (!report.schema_validation.valid) card.append(createElement('p', 'autograder-alert is-high', report.schema_validation.errors.join(' ')));
        else if (report.integrity.status === 'mismatch') card.append(createElement('p', 'autograder-alert is-high', 'Hash mismatch: review this file before gradebook entry. Client-side hashes are not tamper-proof.'));
        if (report.status === 'Incomplete') {
            card.append(createElement('p', 'autograder-alert', text(report.source_data?.package?.incomplete_warning) || 'Partial submission: the student downloaded this package before completing every required lab stage.'));
        }

        const overrides = createElement('div', 'autograder-overrides');
        overrides.append(createElement('h3', '', 'Instructor Override'));
        const overrideGrid = createElement('div', 'autograder-override-grid');
        overrideGrid.append(
            overrideField(report, 'Manual adjustment', 'manual_adjustment', 'number', '0.25'),
            overrideField(report, 'Final approved score', 'final_approved_score', 'number', '0.25'),
            overrideField(report, 'Instructor comment', 'instructor_comment', 'textarea')
        );
        overrides.appendChild(overrideGrid);
        card.appendChild(overrides);

        const reportDownload = createElement('button', 'utility-button', 'Download Individual Report JSON');
        reportDownload.type = 'button';
            reportDownload.addEventListener('click', () => downloadBlob(JSON.stringify(report, null, 2), `SMRTTECH_Lab${String(report.lab.lab_number || 'unknown').padStart(2, '0')}_GradeReport_${safeFilenamePart(report.student.name_or_team || report.file_name)}.json`, 'application/json'));
        card.appendChild(reportDownload);

        [
            [`Submission package contents (${report.submission_package?.entry_count || 0})`, renderPackageContents(report)],
            ['Grading breakdown', renderCategories(report)],
            ['Checkpoint summary', renderCheckpoints(report)],
            ['Instructor review items', renderReviewItems(report)],
            [`Written responses requiring instructor review (${instructorTextResponses(report.source_data).length})`, renderInstructorTextResponses(report)],
            ['Raw response table', renderResponses(report)]
        ].forEach(([title, content], index) => {
            const details = document.createElement('details');
            details.className = 'autograder-details';
            details.open = index <= 1;
            const summary = createElement('summary', '', title);
            details.append(summary, content);
            card.appendChild(details);
        });
        return card;
    }

    function updateBatchControls() {
        document.querySelectorAll('[data-download-gradebook], [data-download-summary], [data-clear-results]').forEach(button => {
            button.disabled = reports.length === 0;
        });
    }

    function renderResults() {
        const container = document.querySelector('[data-autograder-results]');
        if (!container) return;
        container.innerHTML = '';
        if (!reports.length) {
            container.append(createElement('p', 'autograder-empty-state', 'Upload one or more submission ZIP packages or completion JSON files to generate instructor grading reports.'));
        } else {
            reports.forEach(report => container.appendChild(renderReport(report)));
        }
        updateBatchControls();
    }

    function setUploadMessage(message, type) {
        const target = document.querySelector('[data-autograder-message]');
        if (!target) return;
        target.textContent = message;
        target.className = `autograder-upload-message ${type || ''}`;
    }

    function invalidFileReport(fileName, message, submissionPackage = null) {
        const detail = message || 'The submission file could not be read.';
        return {
            report_version: 'smrttech-autograder-v1', generated_at: new Date().toISOString(), file_name: fileName,
            submission_package: submissionPackage, source_data: {}, schema_validation: { valid: false, errors: [detail], warnings: [] },
            integrity: { status: 'not_verified', message: detail }, lab: {}, student: {},
            grading_rule_set: 'unavailable', generic_rules_applied: false, categories: [], autograded_score: 0, possible_score: 0,
            percentage: 0, review_items: [{ category: 'semi_automatic', severity: 'high', type: 'invalid_submission', message: detail, key: `invalid|${fileName}` }],
            instructor_review_required: true, status: 'Invalid file', override_key: `invalid:${safeFilenamePart(fileName)}`,
            override: { manual_adjustment: 0, instructor_comment: '', final_approved_score: null }
        };
    }

    function inferFileType(name) {
        const extension = name.toLowerCase().split('.').pop();
        return ({ json: 'JSON', vi: 'LabVIEW VI', v: 'Verilog source', png: 'PNG image', jpg: 'JPEG image', jpeg: 'JPEG image', gif: 'GIF image', webp: 'WebP image', pdf: 'PDF', txt: 'Text' })[extension] || 'File';
    }

    function packageEntry(name, sizeBytes, compression = 'None') {
        const normalized = name.replace(/\\/g, '/');
        const basename = normalized.split('/').pop().toLowerCase();
        return {
            name: normalized,
            role: basename === 'completion.json' ? 'Completion record' : normalized.toLowerCase().startsWith('evidence/') ? 'Evidence' : 'Other',
            type: inferFileType(normalized),
            size_bytes: sizeBytes,
            compression
        };
    }

    async function parseCompletionText(contents, fileName, submissionPackage = null) {
        try {
            return await gradeCompletion(JSON.parse(contents), { file_name: fileName, submission_package: submissionPackage });
        } catch {
            return invalidFileReport(fileName, 'The completion JSON is invalid.', submissionPackage);
        }
    }

    function findEndOfCentralDirectory(bytes) {
        const minimum = Math.max(0, bytes.length - 65557);
        for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
            if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4B && bytes[offset + 2] === 0x05 && bytes[offset + 3] === 0x06) return offset;
        }
        return -1;
    }

    function readZipDirectory(buffer) {
        const bytes = new Uint8Array(buffer);
        const view = new DataView(buffer);
        const eocd = findEndOfCentralDirectory(bytes);
        if (eocd < 0) throw new Error('The ZIP package has no readable central directory.');
        if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) throw new Error('Multi-disk ZIP packages are not supported.');
        const entryCount = view.getUint16(eocd + 10, true);
        const directoryOffset = view.getUint32(eocd + 16, true);
        if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error(`The ZIP package exceeds the ${MAX_ARCHIVE_ENTRIES}-file safety limit.`);
        const decoder = new TextDecoder('utf-8');
        const entries = [];
        let offset = directoryOffset;
        for (let index = 0; index < entryCount; index += 1) {
            if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014B50) throw new Error('The ZIP package directory is malformed.');
            const flags = view.getUint16(offset + 8, true);
            const method = view.getUint16(offset + 10, true);
            const compressedSize = view.getUint32(offset + 20, true);
            const uncompressedSize = view.getUint32(offset + 24, true);
            const nameLength = view.getUint16(offset + 28, true);
            const extraLength = view.getUint16(offset + 30, true);
            const commentLength = view.getUint16(offset + 32, true);
            const localOffset = view.getUint32(offset + 42, true);
            const end = offset + 46 + nameLength + extraLength + commentLength;
            if (end > bytes.length) throw new Error('A ZIP package entry is truncated.');
            const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
            if (!name.endsWith('/')) entries.push({ name, flags, method, compressedSize, uncompressedSize, localOffset });
            offset = end;
        }
        return { bytes, view, entries };
    }

    async function extractZipEntry(archive, entry, maximumBytes = MAX_COMPLETION_BYTES) {
        const { bytes, view } = archive;
        const offset = entry.localOffset;
        if (offset + 30 > bytes.length || view.getUint32(offset, true) !== 0x04034B50) throw new Error('The completion record has an invalid ZIP entry header.');
        if (entry.flags & 1) throw new Error('Encrypted ZIP packages are not supported.');
        if (entry.uncompressedSize > maximumBytes) throw new Error(`The ZIP entry exceeds the ${formatBytes(maximumBytes)} safety limit.`);
        const nameLength = view.getUint16(offset + 26, true);
        const extraLength = view.getUint16(offset + 28, true);
        const start = offset + 30 + nameLength + extraLength;
        const end = start + entry.compressedSize;
        if (end > bytes.length) throw new Error('The completion record is truncated.');
        const compressed = bytes.slice(start, end);
        if (entry.method === 0) return compressed;
        if (entry.method === 8 && typeof DecompressionStream === 'function') {
            const response = new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
            return new Uint8Array(await response.arrayBuffer());
        }
        throw new Error(`ZIP compression method ${entry.method} is not supported by this browser.`);
    }

    async function parseZipFile(file) {
        if (file.size > MAX_ARCHIVE_BYTES) return invalidFileReport(file.name, 'The ZIP package exceeds the 250 MB safety limit.');
        try {
            const archive = readZipDirectory(await file.arrayBuffer());
            const completionEntries = archive.entries.filter(entry => entry.name.replace(/\\/g, '/').split('/').pop().toLowerCase() === 'completion.json');
            const submissionPackage = {
                format: 'ZIP', archive_name: file.name, completion_entry: completionEntries[0]?.name || '', entry_count: archive.entries.length,
                entries: archive.entries.map(entry => packageEntry(entry.name, entry.uncompressedSize, entry.method === 0 ? 'Stored' : entry.method === 8 ? 'Deflate' : `Method ${entry.method}`))
            };
            if (completionEntries.length !== 1) {
                const message = completionEntries.length ? 'The ZIP package contains more than one completion.json file.' : 'The ZIP package does not contain completion.json.';
                return invalidFileReport(file.name, message, submissionPackage);
            }
            const contents = await extractZipEntry(archive, completionEntries[0]);
            let previewBytes = 0;
            for (let index = 0; index < archive.entries.length; index += 1) {
                const archiveEntry = archive.entries[index];
                const packageItem = submissionPackage.entries[index];
                const normalizedName = packageItem.name.toLowerCase().replace(/\\/g, '/');
                if (normalizedName.startsWith('evidence/verilog-file-') && /\.v$/i.test(normalizedName)) {
                    try {
                        const sourceBytes = await extractZipEntry(archive, archiveEntry, MAX_VERILOG_SOURCE_BYTES);
                        Object.defineProperty(packageItem, 'source_text', {
                            value: new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes),
                            enumerable: false,
                            configurable: true
                        });
                    } catch (error) {
                        packageItem.source_error = error?.message || 'Verilog source could not be read';
                    }
                }
                if (packageItem.type !== 'PNG image') continue;
                if (archiveEntry.uncompressedSize > MAX_PNG_PREVIEW_BYTES) {
                    packageItem.preview_error = 'PNG exceeds the 20 MB preview limit';
                    continue;
                }
                if (previewBytes + archiveEntry.uncompressedSize > MAX_TOTAL_PREVIEW_BYTES) {
                    packageItem.preview_error = 'Batch preview memory limit reached';
                    continue;
                }
                try {
                    const imageBytes = await extractZipEntry(archive, archiveEntry, MAX_PNG_PREVIEW_BYTES);
                    previewBytes += imageBytes.length;
                    if (typeof URL?.createObjectURL === 'function') {
                        Object.defineProperty(packageItem, 'preview_url', { value: URL.createObjectURL(new Blob([imageBytes], { type: 'image/png' })), enumerable: false, configurable: true });
                    } else {
                        packageItem.preview_error = 'PNG previews are unavailable in this browser';
                    }
                } catch (error) {
                    packageItem.preview_error = error?.message || 'PNG preview could not be loaded';
                }
            }
            return parseCompletionText(new TextDecoder('utf-8').decode(contents), file.name, submissionPackage);
        } catch (error) {
            return invalidFileReport(file.name, error?.message || 'The ZIP package could not be read.');
        }
    }

    async function parseSubmissionFile(file) {
        if (file.name.toLowerCase().endsWith('.zip') || ['application/zip', 'application/x-zip-compressed'].includes(file.type)) return parseZipFile(file);
        const submissionPackage = { format: 'JSON', archive_name: file.name, completion_entry: file.name, entry_count: 1, entries: [packageEntry(file.name, file.size)] };
        return parseCompletionText(await file.text(), file.name, submissionPackage);
    }

    async function readUploadedFiles(files) {
        const list = [...files].filter(file => /\.(json|zip)$/i.test(file.name) || ['application/json', 'application/zip', 'application/x-zip-compressed'].includes(file.type));
        if (!list.length) {
            setUploadMessage('Choose one or more ZIP submission packages or JSON completion files.', 'is-warning');
            return;
        }
        const additions = [];
        for (const file of list) {
            additions.push(await parseSubmissionFile(file));
        }
        reports.push(...additions);
        setUploadMessage(`${additions.length} submission file${additions.length === 1 ? '' : 's'} processed locally in this browser.`, 'is-success');
        renderResults();
    }

    function releasePreviewUrls(items) {
        items.forEach(report => asArray(report.submission_package?.entries).forEach(entry => {
            if (entry.preview_url && typeof URL?.revokeObjectURL === 'function') URL.revokeObjectURL(entry.preview_url);
        }));
    }

    function setupPage() {
        const page = document.querySelector('[data-lab-autograder]');
        if (!page) return;
        const input = document.querySelector('[data-autograder-input]');
        const dropZone = document.querySelector('[data-autograder-dropzone]');
        input?.addEventListener('change', event => readUploadedFiles(event.target.files));
        dropZone?.addEventListener('dragover', event => {
            event.preventDefault();
            dropZone.classList.add('is-dragging');
        });
        dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('is-dragging'));
        dropZone?.addEventListener('drop', event => {
            event.preventDefault();
            dropZone.classList.remove('is-dragging');
            readUploadedFiles(event.dataTransfer.files);
        });
        document.querySelector('[data-download-gradebook]')?.addEventListener('click', () => downloadBlob(gradebookCsv(reports), 'SMRTTECH_Lab_Gradebook.csv', 'text/csv'));
        document.querySelector('[data-download-summary]')?.addEventListener('click', () => downloadBlob(JSON.stringify({ report_version: 'smrttech-autograder-v1', generated_at: new Date().toISOString(), reports }, null, 2), 'SMRTTECH_Lab_Gradebook_Detailed.json', 'application/json'));
        document.querySelector('[data-clear-results]')?.addEventListener('click', () => {
            releasePreviewUrls(reports);
            reports.length = 0;
            if (input) input.value = '';
            setUploadMessage('Uploaded reports cleared from this page. Browser-local overrides remain available for the same student and lab.', '');
            renderResults();
        });
        renderResults();
    }

    const api = { validateCompletion, verifyExportHash, gradeCompletion, parseCompletionText, parseSubmissionFile, parseZipFile, readZipDirectory, instructorTextResponses, gradebookCsv, reportToGradebookRow };
    globalThis.LabAutograder = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', setupPage);
})();
