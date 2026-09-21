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
            response('think-compile-program', 'Compilation creates a configuration; programming loads it onto the FPGA.'),
            ...Object.entries(gateOutputs).map(([key, value]) => response(key, value))
        ],
        evidence: [
            { key: 'verilog-file', label: 'Verilog HDL design file', required: true, selected: true, filename: 'student_design.v', includedInZip: true, valid: true },
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

    const report = await autograder.gradeCompletion(data);
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
    const absentReport = await autograder.gradeCompletion(absent);
    const blankReport = await autograder.gradeCompletion(blank);

    assert.equal(absentReport.schema_validation.valid, true);
    assert.equal(blankReport.schema_validation.valid, true);
    assert.equal(blankReport.status, absentReport.status);
    assert.equal(blankReport.autograded_score, absentReport.autograded_score);
    assert.equal(blankReport.review_items.some(item => item.field_id === 'combinational-analysis'), false);
});

test('treats stage 10 as optional export-only UI metadata and ignores obsolete response fields', async () => {
    const baseline = await autograder.gradeCompletion(validLab2());
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
    const report = await autograder.gradeCompletion(legacy);

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
    const report = await autograder.gradeCompletion(data);

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
    const report = await autograder.gradeCompletion(data);

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
    const report = await autograder.gradeCompletion(data);
    assert.equal(report.schema_validation.valid, true);
    assert.equal(report.schema_validation.errors.length, 0);
});

test('rejects a Verilog design filename that does not end in .v', async () => {
    const data = validLab2({
        evidence: validLab2().evidence.map(item => item.key === 'verilog-file' ? { ...item, filename: 'student_design.sv' } : item)
    });
    const report = await autograder.gradeCompletion(data);
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
    const report = await autograder.gradeCompletion(data);
    const validation = report.categories.find(category => category.id === 'validation');
    assert.equal(report.schema_validation.valid, true);
    assert.equal(validation.points_earned, validation.points_possible);
    assert.equal(validation.details.passed, 4);
});

test('rejects a Lab 2 record that is missing one of stages 0 through 9', async () => {
    const data = validLab2({ checkpoints: validLab2().checkpoints.filter(item => item.stage !== 8) });
    const report = await autograder.gradeCompletion(data);
    assert.equal(report.schema_validation.valid, false);
    assert.match(report.schema_validation.errors.join(' '), /stages 0 through 9.*Missing: 8/i);
});
