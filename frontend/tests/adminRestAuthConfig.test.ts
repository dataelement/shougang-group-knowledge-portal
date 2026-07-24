import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createRestAuthDraft,
  normalizeOptionalRestUrl,
  validateRestAuthDraft,
} from '../src/utils/adminRestAuthConfig.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

assert.match(
  readFileSync(join(root, 'src/api/adminConfig.ts'), 'utf8'),
  /fetchRestAuthRuntimeConfig\(\)[\s\S]*\/api\/v1\/admin\/config\/rest-auth/,
);

assert.match(
  readFileSync(join(root, 'src/pages/AdminPage.tsx'), 'utf8'),
  /RestAuthAdminSection/,
);

const invalid = validateRestAuthDraft(
  createRestAuthDraft({
    enabled: true,
    rest_base_url: '',
    rest_app_id: '',
    authenticate_url: '',
    token_valid_url: '',
    user_attributes_url: '',
    rest_token_id_param: 'tokenId',
    http_timeout_seconds: 10,
    token_check_interval_seconds: 300,
    verify_tls: true,
    login_sync_signature_header: 'X-Signature',
    bisheng_lookup_required: false,
    has_login_sync_hmac_secret: false,
    missing_fields: ['rest_base_url', 'rest_app_id', 'login_sync_hmac_secret'],
  }),
);

assert.equal(invalid.error, '启用 REST 前需要填写 REST Base URL');

const valid = validateRestAuthDraft(
  {
    ...createRestAuthDraft(),
    enabled: true,
    rest_base_url: 'https://iam.example.com',
    rest_app_id: 'portal-rest',
    login_sync_hmac_secret: 'secret',
  },
);

assert.ok(valid.payload);
assert.equal(valid.payload?.rest_base_url, 'https://iam.example.com');

assert.equal(
  normalizeOptionalRestUrl('/idp/restful/getIDPUserAttributes', 'https://iam.example.com'),
  'https://iam.example.com/idp/restful/getIDPUserAttributes',
);

const relative = validateRestAuthDraft({
  ...createRestAuthDraft(),
  enabled: true,
  rest_base_url: 'https://iam.example.com',
  rest_app_id: 'portal-rest',
  user_attributes_url: '/idp/restful/getIDPUserAttributes',
});

assert.equal(
  relative.payload?.user_attributes_url,
  'https://iam.example.com/idp/restful/getIDPUserAttributes',
);

const barePath = validateRestAuthDraft({
  ...createRestAuthDraft(),
  enabled: true,
  rest_base_url: 'https://iam.example.com',
  rest_app_id: 'portal-rest',
  user_attributes_url: 'idp/restful/getIDPUserAttributes',
});
assert.equal(
  barePath.payload?.user_attributes_url,
  'https://iam.example.com/idp/restful/getIDPUserAttributes',
);

const template = validateRestAuthDraft({
  ...createRestAuthDraft(),
  enabled: true,
  rest_base_url: 'https://iam.example.com',
  rest_app_id: 'portal-rest',
  user_attributes_url: '{base_url}/idp/restful/getIDPUserAttributes',
});
assert.equal(template.payload?.user_attributes_url, '');

console.log('adminRestAuthConfig.test.ts passed');
