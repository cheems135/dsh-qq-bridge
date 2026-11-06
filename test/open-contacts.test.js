import test from 'node:test';
import assert from 'node:assert/strict';
import {privateInitiativeAllowed,allowedPrivateUsers,recipientDenial} from '../contact-policy.js';
test('open permission removes proactive opt-out only within enabled allowlist',()=>{
 const s={permissionsMode:'open-nonpayment',whitelist:['12345678','23456789'],disabledUsers:['23456789'],owners:['12345678'],contactProfiles:{'private:12345678':{proactive:false}}};
 assert.equal(privateInitiativeAllowed('private:12345678',s),true);
 assert.equal(privateInitiativeAllowed('private:23456789',s),false);
 assert.equal(privateInitiativeAllowed('private:34567890',s),false);
 assert.deepEqual(allowedPrivateUsers(s),['12345678']);
 assert.ok(recipientDenial({kind:'private',key:'private:34567890',chatId:'34567890'},s));
});
