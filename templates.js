export const MAIL_TEMPLATES = {

  ncm1_onsite: {
    subject: "Follow-up on Your HP Service Case – {{caseId}}",

    body:
`Hi {{customerName}},

This email is in reference to Case Number: {{caseId}}.

We attempted to reach you regarding your HP product {{productName}}.

Please respond so we can proceed.

Best Regards,
{{agentFirstName}}`
  },

  ncm1_offsite: {
    subject: "Follow-up on Your HP Service Case – {{caseId}}",
    body: `...`
  },

  ncm1_parts: {
    subject: "Follow-up on Your HP Service Case – {{caseId}}",
    body: `...`
  }

};
