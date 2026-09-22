'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../assets/js/lab-grading-rules.js');
const autograder = require('../assets/js/lab-autograder.js');

const gateOutputs = {
    'nand-0': '1', 'nand-1': '1', 'nand-2': '1', 'nand-3': '0',
    'xor-0': '0', 'xor-1': '1', 'xor-2': '1', 'xor-3': '0',
    'xnor-0': '1', 'xnor-1': '0', 'xnor-2': '0', 'xnor-3': '1'
};

function response(key, value) {
    return { key, label: key, value };
}

function validVerilog(moduleName = 'student_design') {
    return `module ${moduleName} (d1, d2, LED0, LED1, LED2, LED3, LED4, LED5, LED6, LED7);
input d1, d2;
output LED0, LED1, LED2, LED3, LED4, LED5, LED6, LED7;
assign LED0 = d1;
assign LED1 = d2;
assign LED2 = d1 & d2;
assign LED3 = d1 | d2;
assign LED4 = d1 ^ d2;
assign LED5 = ~(d1 & d2);
assign LED6 = ~(d1 | d2);
assign LED7 = ~(d1 ^ d2);
endmodule`;
}

function submissionPackage(data, source) {
    const filename = data.evidence.find(item => item.key === 'verilog-file')?.filename || 'student_design.v';
    const moduleName = filename.replace(/\.v$/i, '');
    return {
        format: 'ZIP',
        archive_name: '3DE3_Lab02_Submission.zip',
        completion_entry: 'completion.json',
        entry_count: 2,
        entries: [
            { name: 'completion.json', role: 'Completion record', type: 'JSON' },
            { name: `evidence/verilog-file-${filename}`, role: 'Evidence', type: 'Verilog source', source_text: source ?? validVerilog(moduleName) }
        ]
    };
}

function gradeLab2(data, source) {
    return autograder.gradeCompletion(data, { submission_package: submissionPackage(data, source) });
}

function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function integerBytes(value, size) {
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    if (size === 2) view.setUint16(0, value, true);
    else view.setUint32(0, value, true);
    return bytes;
}

function joinBytes(parts) {
    const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    parts.forEach(part => { joined.set(part, offset); offset += part.length; });
    return joined;
}

function storedZip(files) {
    const encoder = new TextEncoder();
    const localEntries = [];
    const centralEntries = [];
    let offset = 0;
    Object.entries(files).forEach(([name, value]) => {
        const nameBytes = encoder.encode(name);
        const data = typeof value === 'string' ? encoder.encode(value) : value;
        const checksum = crc32(data);
        const local = joinBytes([integerBytes(0x04034B50, 4), integerBytes(20, 2), integerBytes(0x0800, 2), integerBytes(0, 2), integerBytes(0, 2), integerBytes(0, 2), integerBytes(checksum, 4), integerBytes(data.length, 4), integerBytes(data.length, 4), integerBytes(nameBytes.length, 2), integerBytes(0, 2), nameBytes, data]);
        localEntries.push(local);
        centralEntries.push(joinBytes([integerBytes(0x02014B50, 4), integerBytes(20, 2), integerBytes(20, 2), integerBytes(0x0800, 2), integerBytes(0, 2), integerBytes(0, 2), integerBytes(0, 2), integerBytes(checksum, 4), integerBytes(data.length, 4), integerBytes(data.length, 4), integerBytes(nameBytes.length, 2), integerBytes(0, 2), integerBytes(0, 2), integerBytes(0, 2), integerBytes(0, 2), integerBytes(0, 4), integerBytes(offset, 4), nameBytes]));
        offset += local.length;
    });
    const central = joinBytes(centralEntries);
    return joinBytes([...localEntries, central, integerBytes(0x06054B50, 4), integerBytes(0, 2), integerBytes(0, 2), integerBytes(centralEntries.length, 2), integerBytes(centralEntries.length, 2), integerBytes(central.length, 4), integerBytes(offset, 4), integerBytes(0, 2)]);
}

function validLab2(overrides = {}) {
    const data = {
        schema_version: '3de3-lab-completion-v1',
        course: { code: 'SMRTTECH 3DE3', shortCode: '3DE3', title: 'Digital Electronics' },
        lab: { id: 'lab-02', number: 2, title: 'FPGA Logic Design' },
        generated_at: '2026-09-21T12:00:00.000Z',
        student: {
            student_names: 'Test Student',
            student_numbers: '400000001',
            lab_section: 'L01',
            instructor: 'Test Instructor'
        },
        checkpoints: Array.from({ length: 10 }, (_, stage) => ({
            id: `stage-${stage}`,
            stage,
            title: stage === 9 ? 'Think It Through' : `Stage ${stage}`,
            required: true,
            complete: true
        })),
        responses: [
            response('board-logic-elements', '22,320'),
            response('board-sensor', 'ADXL345 three-axis accelerometer measuring acceleration on the X, Y, and Z axes.'),
            response('quartus-project-name', 'Lab2'),
            response('verilog-module', 'student_design'),
            response('verilog-dip-00', 'LED0=0, LED1=0, LED2=0'),
            response('verilog-dip-01', 'LED0=0, LED1=1, LED2=0'),
            response('verilog-dip-10', 'LED0=1, LED1=0, LED2=0'),
            response('verilog-dip-11', 'LED0=1, LED1=1, LED2=1'),
            response('verilog-circuit-recreated', true),
            response('output-buffers', '8'),
            response('verilog-verification', 'Matched the earlier schematic for all four input combinations: 00, 01, 10, and 11.'),
            response('think-compile-program', 'Compilation creates a configuration; programming loads it onto the FPGA.'),
            ...Object.entries(gateOutputs).map(([key, value]) => response(key, value))
        ],
        evidence: [
            { key: 'verilog-file', label: 'Verilog HDL design file', required: true, selected: true, filename: 'student_design.v', includedInZip: true, valid: true },
            { key: 'rtl-capture', label: 'RTL Viewer screenshot', required: true, selected: true, filename: 'rtl.png', includedInZip: true, valid: true },
            { key: 'verilog-board', label: 'Working board screenshot', required: true, selected: true, filename: 'board.png', includedInZip: true, valid: true },
            { key: 'and-schematic', label: 'AND schematic', required: true, selected: true, filename: 'and.png', includedInZip: true, valid: true }
        ],
        completion: { complete: true, status: 'complete', completed_stages: 10, total_stages: 10 },
        package: { format: 'ZIP', submission_type: 'complete', completion_record: 'completion.json', evidence_folder: 'evidence/' },
        integrity_notice: { client_generated: true, tamper_proof: false }
    };
    return Object.assign(data, overrides);
}

test('accepts the revised 10-stage Lab 2 schema with only NAND, XOR, and XNOR outputs', async () => {
    const data = validLab2();
    const responseKeys = data.responses.map(item => item.key);
    assert.equal(data.checkpoints.length, 10);
    assert.deepEqual(data.checkpoints.map(item => item.stage), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(responseKeys.some(key => /^(or|nor)-[0-3]$/.test(key)), false);
    assert.equal(responseKeys.some(key => /-led-[0-3]$/.test(key)), false);
    assert.equal(responseKeys.includes('lab2-final-review'), false);

    const report = await gradeLab2(data);
    assert.equal(report.schema_validation.valid, true);
    assert.equal(report.grading_rule_set, '3de3-lab-2-v2');
    assert.equal(report.status, 'Ready for gradebook');
    assert.equal(report.lab.completion_percent, 100);
    const gates = report.categories.find(category => category.id === 'gate_outputs');
    assert.equal(gates.points_earned, gates.points_possible);
    assert.equal(gates.details.total, 12);
});

test('blank or absent combinational-analysis is optional and does not affect result or score', async () => {
    const absent = validLab2();
    const blank = validLab2({ responses: [...validLab2().responses, response('combinational-analysis', '')] });
    const absentReport = await gradeLab2(absent);
    const blankReport = await gradeLab2(blank);

    assert.equal(absentReport.schema_validation.valid, true);
    assert.equal(blankReport.schema_validation.valid, true);
    assert.equal(blankReport.status, absentReport.status);
    assert.equal(blankReport.autograded_score, absentReport.autograded_score);
    assert.equal(blankReport.review_items.some(item => item.field_id === 'combinational-analysis'), false);
});

test('treats stage 10 as optional export-only UI metadata and ignores obsolete response fields', async () => {
    const baseline = await gradeLab2(validLab2());
    const legacyResponses = [
        response('lab2-final-review', false),
        ...['or', 'nor'].flatMap(gate => [0, 1, 2, 3].map(index => response(`${gate}-${index}`, 'wrong'))),
        ...['or', 'nand', 'nor', 'xor', 'xnor'].flatMap(gate => [0, 1, 2, 3].map(index => response(`${gate}-led-${index}`, 'wrong')))
    ];
    const legacy = validLab2({
        checkpoints: [...validLab2().checkpoints, { id: 'stage-10', stage: 10, title: 'Completion', required: true, complete: false }],
        responses: [...validLab2().responses, ...legacyResponses],
        completion: { complete: false, status: 'incomplete', completed_stages: 10, total_stages: 11 }
    });
    const report = await gradeLab2(legacy);

    assert.equal(report.schema_validation.valid, true);
    assert.equal(report.status, 'Ready for gradebook');
    assert.equal(report.lab.completion_percent, 100);
    assert.equal(report.autograded_score, baseline.autograded_score);
    assert.equal(report.review_items.some(item => legacyResponses.some(responseItem => responseItem.key === item.field_id)), false);
});

test('does not require stage 10 or top-level complete/status flags when graded stages 0-9 are complete', async () => {
    const data = validLab2({
        completion: { completed_stages: 10, total_stages: 10 }
    });
    const report = await gradeLab2(data);

    assert.equal(data.checkpoints.some(checkpoint => checkpoint.stage === 10), false);
    assert.equal(report.schema_validation.valid, true);
    assert.equal(report.status, 'Ready for gradebook');
    assert.equal(report.lab.completion_status, 'complete');
    assert.equal(report.lab.completion_percent, 100);
    assert.deepEqual(report.categories.find(category => category.id === 'completion').details, { completed: 10, total: 10 });
});

test('marks the ZIP partial when a graded stage is incomplete even if stage 10 and exported completion flags say complete', async () => {
    const data = validLab2({
        checkpoints: [
            ...validLab2().checkpoints.map(checkpoint => checkpoint.stage === 8 ? { ...checkpoint, complete: false } : checkpoint),
            { id: 'stage-10', stage: 10, title: 'Completion', required: false, complete: true }
        ],
        completion: { complete: true, status: 'complete', completed_stages: 11, total_stages: 11 }
    });
    const report = await gradeLab2(data);

    assert.equal(report.schema_validation.valid, true);
    assert.equal(report.status, 'Incomplete');
    assert.equal(report.lab.completion_status, 'incomplete');
    assert.equal(report.lab.completion_percent, 90);
    assert.deepEqual(report.categories.find(category => category.id === 'completion').details, { completed: 9, total: 10 });
    assert.equal(report.review_items.some(item => item.checkpoint_id === 'stage-10'), false);
    assert.equal(report.review_items.some(item => item.checkpoint_id === 'stage-8'), true);
});

test('accepts any student-selected .v filename case-insensitively', async () => {
    const data = validLab2({
        responses: validLab2().responses.map(item => item.key === 'verilog-module' ? response('verilog-module', 'My_Controller') : item),
        evidence: validLab2().evidence.map(item => item.key === 'verilog-file' ? { ...item, filename: 'My_Controller.V' } : item)
    });
    const report = await gradeLab2(data);
    assert.equal(report.schema_validation.valid, true);
    assert.equal(report.schema_validation.errors.length, 0);
});

test('rejects a Verilog design filename that does not end in .v', async () => {
    const data = validLab2({
        evidence: validLab2().evidence.map(item => item.key === 'verilog-file' ? { ...item, filename: 'student_design.sv' } : item)
    });
    const report = await gradeLab2(data);
    assert.equal(report.schema_validation.valid, false);
    assert.equal(report.status, 'Invalid file');
    assert.match(report.schema_validation.errors.join(' '), /must end in \.v.*student_design\.sv/i);
});

test('accepts board-reference formats and reasonable Lab2 capitalization', async () => {
    const data = validLab2({
        responses: validLab2().responses.map(item => {
            if (item.key === 'board-logic-elements') return response(item.key, '22320');
            if (item.key === 'board-sensor') return response(item.key, 'The ADXL345 senses tilt, gravity, motion, and board orientation.');
            if (item.key === 'quartus-project-name') return response(item.key, 'lAb2');
            return item;
        })
    });
    const report = await gradeLab2(data);
    const validation = report.categories.find(category => category.id === 'validation');
    assert.equal(report.schema_validation.valid, true);
    assert.equal(validation.points_earned, validation.points_possible);
    assert.equal(validation.details.passed, validation.details.total);
});

test('flags a missing DIP-switch observation', async () => {
    const data = validLab2({ responses: validLab2().responses.filter(item => item.key !== 'verilog-dip-10') });
    const report = await gradeLab2(data);
    const validation = report.categories.find(category => category.id === 'validation');

    assert.equal(report.schema_validation.valid, true);
    assert.ok(validation.points_earned < validation.points_possible);
    assert.equal(report.review_items.some(item => item.field_id === 'verilog-dip-10'), true);
});

test('flags an unchecked circuit-recreation confirmation', async () => {
    const data = validLab2({
        responses: validLab2().responses.map(item => item.key === 'verilog-circuit-recreated' ? response(item.key, false) : item)
    });
    const report = await gradeLab2(data);
    const validation = report.categories.find(category => category.id === 'validation');

    assert.equal(report.schema_validation.valid, true);
    assert.ok(validation.points_earned < validation.points_possible);
    assert.equal(report.review_items.some(item => item.field_id === 'verilog-circuit-recreated'), true);
});

test('continues requiring synthesis evidence, output buffers, and four-case verification', async () => {
    const base = validLab2();
    const data = validLab2({
        responses: base.responses
            .filter(item => item.key !== 'output-buffers')
            .map(item => item.key === 'verilog-verification' ? response(item.key, 'Looks good') : item),
        evidence: base.evidence.filter(item => !['rtl-capture', 'verilog-board'].includes(item.key))
    });
    const report = await gradeLab2(data);
    const validation = report.categories.find(category => category.id === 'validation');
    const missingIds = new Set(report.review_items.map(item => item.field_id));

    assert.equal(report.schema_validation.valid, true);
    assert.ok(validation.points_earned < validation.points_possible);
    ['output-buffers', 'verilog-verification', 'rtl-capture', 'verilog-board'].forEach(id => {
        assert.equal(missingIds.has(id), true, `${id} should be flagged for review`);
    });
});

test('rejects Verilog source missing the d1 or d2 input declaration', async () => {
    const source = validVerilog().replace('input d1, d2;', 'input d1;');
    const report = await gradeLab2(validLab2(), source);

    assert.equal(report.schema_validation.valid, false);
    assert.match(report.schema_validation.errors.join(' '), /declare d2 as an input/i);
});

test('rejects Verilog source missing required LED outputs and their logic', async () => {
    const source = validVerilog()
        .replace(', LED7);', ');')
        .replace(', LED7;', ';')
        .replace(/\nassign LED7 = [^;]+;/, '');
    const report = await gradeLab2(validLab2(), source);

    assert.equal(report.schema_validation.valid, false);
    assert.match(report.schema_validation.errors.join(' '), /declare LED7 as an output/i);
    assert.match(report.schema_validation.errors.join(' '), /provide logic for LED7/i);
});

test('reads and validates a complete Verilog design directly from the uploaded ZIP', async () => {
    const data = validLab2();
    const source = validVerilog();
    const zip = storedZip({
        'completion.json': JSON.stringify(data),
        'evidence/verilog-file-student_design.v': source
    });
    const report = await autograder.parseSubmissionFile(new File([zip], '3DE3_Lab02_Submission.zip', { type: 'application/zip' }));
    const validation = report.categories.find(category => category.id === 'validation');

    assert.equal(report.schema_validation.valid, true);
    assert.equal(report.status, 'Ready for gradebook');
    assert.equal(validation.points_earned, validation.points_possible);
    assert.equal(JSON.stringify(report).includes(source), false);
});

test('rejects a Lab 2 record that is missing one of stages 0 through 9', async () => {
    const data = validLab2({ checkpoints: validLab2().checkpoints.filter(item => item.stage !== 8) });
    const report = await gradeLab2(data);
    assert.equal(report.schema_validation.valid, false);
    assert.match(report.schema_validation.errors.join(' '), /stages 0 through 9.*Missing: 8/i);
});
