import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDepartmentBusinessDomainBindings,
  validateDepartmentBusinessDomainBindings,
} from '../src/utils/departmentBusinessDomains';

test('department business-domain bindings normalize codes and preserve exact departments', () => {
  const normalized = normalizeDepartmentBusinessDomainBindings([
    { department_id: 20, business_domain_codes: [' safe ', 'PP', 'SAFE'] },
    { department_id: 10, business_domain_codes: ['hr'] },
  ]);

  assert.deepEqual(normalized, [
    { department_id: 10, business_domain_codes: ['HR'] },
    { department_id: 20, business_domain_codes: ['PP', 'SAFE'] },
  ]);
});

test('department business-domain bindings reject duplicate departments and invalid domains', () => {
  assert.match(validateDepartmentBusinessDomainBindings([
    { department_id: 10, business_domain_codes: ['PP'] },
    { department_id: 10, business_domain_codes: ['SAFE'] },
  ], ['PP', 'SAFE']), /只能配置一次/);

  assert.match(validateDepartmentBusinessDomainBindings([
    { department_id: 10, business_domain_codes: ['UNKNOWN'] },
  ], ['PP', 'SAFE']), /不存在或已停用/);
});

test('empty bindings are valid for full replacement clear', () => {
  assert.equal(validateDepartmentBusinessDomainBindings([], ['PP']), '');
});

test('a visible draft without a department is rejected before normalization', () => {
  const drafts = [{ department_id: 0, business_domain_codes: ['PP'] }];

  assert.match(validateDepartmentBusinessDomainBindings(drafts, ['PP']), /选择一个部门/);
  assert.deepEqual(normalizeDepartmentBusinessDomainBindings(drafts), []);
});
