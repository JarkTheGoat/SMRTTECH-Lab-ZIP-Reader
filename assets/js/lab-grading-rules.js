(() => {
    'use strict';

    const LAB_1_MEASUREMENTS = [
        't1-r-0', 't1-r-25', 't1-r-50', 't1-r-75', 't1-r-100',
        't2-v-0', 't2-v-25', 't2-v-50', 't2-v-75', 't2-v-100',
        'arduino-dark-reading', 'arduino-bright-reading',
        't3-r-dark', 't3-r-normal', 't3-r-flash',
        't4-vcalc-dark', 't4-vcalc-normal', 't4-vcalc-flash',
        't4-vmeas-dark', 't4-vmeas-normal', 't4-vmeas-flash'
    ];

    const GENERIC_RULES = {
        id: 'generic-labs-2-8-v1',
        label: 'Generic Labs 2-8 completion rubric',
        total_points: 10,
        generic: true,
        categories: [
            { id: 'completion', label: 'Required checkpoint completion', points: 3, method: 'required_checkpoints_complete' },
            { id: 'auto_checks', label: 'Knowledge and ordering checks', points: 2, method: 'auto_check_pass_rate' },
            { id: 'responses', label: 'Responses and measurements', points: 2, method: 'response_presence' },
            { id: 'validation', label: 'Validation and flags', points: 2, method: 'validation_quality' },
            { id: 'reflection_evidence', label: 'Reflection and evidence', points: 1, method: 'reflection_evidence' }
        ]
    };

    const LAB_2_3DE3_RULES = {
        id: '3de3-lab-2-v2',
        label: '3DE3 Lab 2 revised completion rubric',
        lab_title: 'Lab 2: FPGA Logic Design',
        total_points: 10,
        categories: [
            { id: 'completion', label: 'Required checkpoint completion', points: 3, method: 'required_checkpoints_complete' },
            { id: 'gate_outputs', label: 'NAND, XOR, and XNOR investigation', points: 2, method: 'lab2_gate_outputs' },
            { id: 'responses', label: 'Remaining responses and measurements', points: 2, method: 'response_presence' },
            { id: 'validation', label: 'Lab 2 reference and project checks', points: 2, method: 'lab2_validation_quality' },
            { id: 'reflection_evidence', label: 'Reflection and evidence', points: 1, method: 'reflection_evidence' }
        ]
    };

    const LAB_GRADING_RULES = {
        generic: GENERIC_RULES,
        '3de3': {
            2: LAB_2_3DE3_RULES
        },
        1: {
            id: 'lab-1-v1',
            label: 'Lab 1 completion rubric',
            lab_title: 'Lab 1: LabVIEW, Tinkercad and Arduino Sensors',
            total_points: 10,
            categories: [
                { id: 'completion', label: 'Required checkpoint completion', points: 2, method: 'required_checkpoints_complete' },
                { id: 'knowledge_checks', label: 'Knowledge checks', points: 2, method: 'knowledge_check_pass_rate' },
                { id: 'measurements', label: 'Recorded measurements', points: 2, method: 'response_presence', response_ids: LAB_1_MEASUREMENTS },
                { id: 'validation', label: 'Validation quality', points: 2, method: 'validation_quality' },
                { id: 'submission_readiness', label: 'Submission readiness', points: 2, method: 'submission_readiness' }
            ]
        }
    };

    globalThis.LAB_GRADING_RULES = LAB_GRADING_RULES;
    if (typeof module !== 'undefined' && module.exports) module.exports = LAB_GRADING_RULES;
})();
