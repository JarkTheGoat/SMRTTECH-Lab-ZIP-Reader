'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../assets/js/lab-grading-rules.js');
const autograder = require('../assets/js/lab-autograder.js');

function bytes(value, size) {
    const result = new Uint8Array(size);
    const view = new DataView(result.buffer);
    if (size === 2) view.setUint16(0, value, true);
    else view.setUint32(0, value, true);
    return result;
}

function join(parts) {
    const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
}

function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function storedZip(files) {
    const encoder = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        const nameBytes = encoder.encode(name);
        const data = typeof content === 'string' ? encoder.encode(content) : content;
        const checksum = crc32(data);
        const local = join([bytes(0x04034B50, 4), bytes(20, 2), bytes(0x0800, 2), bytes(0, 2), bytes(0, 2), bytes(0, 2), bytes(checksum, 4), bytes(data.length, 4), bytes(data.length, 4), bytes(nameBytes.length, 2), bytes(0, 2), nameBytes, data]);
        locals.push(local);
        centrals.push(join([bytes(0x02014B50, 4), bytes(20, 2), bytes(20, 2), bytes(0x0800, 2), bytes(0, 2), bytes(0, 2), bytes(0, 2), bytes(checksum, 4), bytes(data.length, 4), bytes(data.length, 4), bytes(nameBytes.length, 2), bytes(0, 2), bytes(0, 2), bytes(0, 2), bytes(0, 2), bytes(0, 4), bytes(offset, 4), nameBytes]));
        offset += local.length;
    }
    const central = join(centrals);
    return join([...locals, central, bytes(0x06054B50, 4), bytes(0, 2), bytes(0, 2), bytes(centrals.length, 2), bytes(centrals.length, 2), bytes(central.length, 4), bytes(offset, 4), bytes(0, 2)]);
}

function completion(name) {
    return {
        schema_version: '3de3-lab-completion-v1',
        lab: { lab_number: 1, lab_title: 'Test lab' },
        student: { student_names: name, student_numbers: '000000000', lab_section: 'L01' },
        checkpoints: [{ id: 'stage-0', stage: 0, title: 'Prepare', required: true, complete: true }],
        completion: { complete: true, total_stages: 1, completed_stages: 1 },
        integrity_notice: 'Test fixture'
    };
}

test('imports an instructor batch in roster order and preserves archive identifiers in exports', async () => {
    const betaZip = storedZip({ 'completion.json': JSON.stringify(completion('Alex Beta')) });
    const alphaZip = storedZip({ 'completion.json': JSON.stringify(completion('Zoe Alpha')) });
    const index = '<tr bgcolor=#AAAAAA><td colspan=2><font color=white><b>Alpha, Zoe</b></td></tr>' +
        '<tr bgcolor=#AAAAAA><td colspan=2><font color=white><b>Beta, Alex</b></td></tr>';
    const archive = storedZip({
        'index.html': index,
        '100-Alex_Beta.zip': betaZip,
        '101-Zoe_Alpha.zip': alphaZip,
        '102-notes.txt': 'Unexpected file',
        '103-broken.zip': 'Not a ZIP'
    });
    const reports = await autograder.parseUploadedFile(new File([archive], 'Section download.zip', { type: 'application/zip' }));
    const csv = autograder.gradebookCsv(reports);

    assert.equal(reports.length, 4);
    assert.deepEqual(reports.slice(0, 2).map(report => report.student.name_or_team), ['Zoe Alpha', 'Alex Beta']);
    assert.deepEqual(reports.slice(0, 2).map(report => report.batch.roster_position), [1, 2]);
    assert.deepEqual(reports.slice(0, 2).map(report => report.batch.submission_id), ['101', '100']);
    assert.equal(reports.filter(report => report.schema_validation.valid).length, 2);
    assert.equal(reports.filter(report => report.status === 'Invalid file').length, 2);
    assert.match(reports.find(report => report.file_name.endsWith('notes.txt')).schema_validation.errors[0], /not a student submission ZIP/i);
    assert.match(csv.split('\r\n')[0], /^batch_archive,batch_entry,batch_submission_id,roster_position,roster_names,/);
    assert.equal(csv.split('\r\n').length, 5);
    assert.match(csv, /Section download\.zip,101-Zoe_Alpha\.zip,101,1/);
});

test('keeps a standalone student ZIP as one report', async () => {
    const zip = storedZip({ 'completion.json': JSON.stringify(completion('Single Student')) });
    const reports = await autograder.parseUploadedFile(new File([zip], 'student.zip', { type: 'application/zip' }));

    assert.equal(reports.length, 1);
    assert.equal(reports[0].schema_validation.valid, true);
    assert.equal(reports[0].batch, undefined);
});

test('accepts 3CC3 records inside a batch and preserves Excel-safe names', async () => {
    const record = {
        schema_version: '3cc3-lab-completion-v1',
        lab: { lab_number: 1, lab_title: 'Test lab', completion_status: 'complete' },
        student: { name_or_team: '=2+2', student_numbers: '000000001' },
        checkpoints: [{ id: 'prepare', title: 'Prepare', required: true, status: 'complete' }],
        grading_summary: { total_required_checkpoints: 1, completed_required_checkpoints: 1, missing_required_checkpoints: [] },
        integrity_notice: 'Test fixture'
    };
    const archive = storedZip({ '200-team.zip': storedZip({ 'completion.json': JSON.stringify(record) }) });
    const reports = await autograder.parseUploadedFile(new File([archive], '3CC3 section.zip', { type: 'application/zip' }));

    assert.equal(reports.length, 1);
    assert.equal(reports[0].schema_validation.valid, true);
    assert.equal(reports[0].batch.submission_id, '200');
    assert.match(autograder.gradebookCsv(reports), /'=2\+2/);
});
