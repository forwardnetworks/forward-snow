import { Test } from '@servicenow/sdk/core'

Test(
    {
        $id: Now.ID['install_metadata_atf'],
        name: 'Forward Change Assurance - install metadata',
        description: 'Verify packaged tables, roles, script includes, and strict credential configuration',
        active: true,
        failOnServerError: true,
    },
    (atf) => {
        atf.server.runServerSideScript({
            $id: Now.ID['install_metadata_server_test'],
            script: `(function () {
  describe('Forward Change Assurance install metadata', function () {
    it('installs the two package-private ledger tables', function () {
      expect(new GlideRecord('__SCOPE___assurance').isValid()).toBe(true);
      expect(new GlideRecord('__SCOPE___validation').isValid()).toBe(true);
    });
    it('installs all packaged roles and script includes', function () {
      ['admin', 'operator', 'auditor', 'evidence_writer'].forEach(function (suffix) {
        var role = new GlideRecord('sys_user_role');
        role.addQuery('name', '__SCOPE__.' + suffix);
        role.setLimit(1);
        role.query();
        expect(role.next()).toBe(true);
      });
      ['ChangeAssuranceContract', 'ChangeAssuranceService', 'ChangeAssuranceFlowClient', 'ChangeAssuranceCloseGuard', 'ForwardApiClient', 'ForwardPathCheck', 'ForwardMapsLookup', 'ForwardPredict', 'ForwardValidation'].forEach(function (name) {
        var include = new GlideRecord('sys_script_include');
        include.addQuery('name', name);
        include.addQuery('sys_scope.scope', '__SCOPE__');
        include.setLimit(1);
        include.query();
        expect(include.next()).toBe(true);
      });
      var closeGuard = new GlideRecord('sys_script');
      closeGuard.addQuery('name', 'Forward Change Assurance close guard');
      closeGuard.addQuery('collection', 'change_request');
      closeGuard.addQuery('sys_scope.scope', '__SCOPE__');
      closeGuard.addQuery('active', true);
      closeGuard.setLimit(1);
      closeGuard.query();
      expect(closeGuard.next()).toBe(true);
    });
    it('does not install credential values or unscoped properties', function () {
      var property = new GlideRecord('sys_properties');
      property.addQuery('name', 'IN', [
        '__SCOPE__.assurance.worker_base_url', '__SCOPE__.assurance.worker_allowed_base_urls',
        '__SCOPE__.assurance.worker_auth_profile', '__SCOPE__.forward.allowed_base_urls'
      ].join(','));
      property.setLimit(1);
      property.query();
      expect(property.hasNext()).toBe(false);
    });
  });
})();`,
        })
    },
)

Test(
    {
        $id: Now.ID['worker_alias_readiness_atf'],
        name: 'Forward Change Assurance - worker alias readiness',
        description: 'Verify the required packaged alias has exactly one customer-owned active connection binding',
        active: true,
        failOnServerError: true,
    },
    (atf) => {
        atf.server.runServerSideScript({
            $id: Now.ID['worker_alias_readiness_server_test'],
            script: `(function () {
  describe('Forward Change Assurance worker alias readiness', function () {
    it('resolves one bound active connection without exposing credential values', function () {
      var alias = new GlideRecord('sys_alias');
      alias.addQuery('name', 'Forward Change Assurance Worker');
      alias.addQuery('sys_scope.scope', '__SCOPE__');
      alias.query();
      expect(alias.next()).toBe(true);
      var aliasSysId = String(alias.getUniqueValue() || '');
      expect(alias.next()).toBe(false);
      var info = new sn_cc.ConnectionInfoProvider().getConnectionInfo(aliasSysId);
      expect(info).not.toBeNull();
      expect(String(info.getAttribute('connection_url') || '')).toMatch(/^https:\\/\\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/);
    });
  });
})();`,
        })
    },
)
