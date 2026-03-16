export const templates = {

  kci: {
    subject: "KCI Notes",
    body: `KCI Notes Template`
  },

ncm1: {

  getTemplate(caseData) {

    const { caseResolutionCode, benchRFC } = caseData;

    if (caseResolutionCode === "Onsite Solution") {
      return {
        subject: `Follow-up on Your HP Service Case – {{caseId}}`,
        body: `Hi {{customerName}},

I hope you are doing well.

This email is in reference to Case Number: {{caseId}}.

We have received confirmation that the onsite repair for the device listed below has been successfully completed.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}

We attempted to contact you to confirm whether the device is functioning properly after the repair; 
however, we were unable to reach you.

Kindly provide us with an update on the current status of the device so that we may proceed accordingly. 
If the issue persists or if you require any further assistance, please feel free to let us know—we will be glad to help.

You may also contact our HP support helpline if you require immediate assistance.

Thank you for choosing HP.

Kind regards,
{{agentFirstName}}
HP Inc.`
      };
    }

    if (caseResolutionCode === "Offsite Solution" &&
        benchRFC === "Order cancelled, not to be reopened") {

      return {
        subject: `Follow-up on Your HP Service Case – {{caseId}}`,
        body: `Hi {{customerName}},

I hope you are doing well.

This email is regarding Case Number: {{caseId}}.

A pickup service was arranged for your device; however, the unit could not be collected due to multiple unsuccessful pickup attempts.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}

We attempted to contact you regarding this update but were unable to reach you.

Kindly let us know if the issue with the device has been resolved or if you would still like us to arrange the repair service. 
Based on your confirmation, we will proceed accordingly.

If you require any further assistance with your HP device, please feel free to let us know—we will be glad to help.

Thank you for choosing HP.

Kind regards,
{{agentFirstName}}
HP Inc.`
      };
    }

    if (caseResolutionCode === "Offsite Solution") {
      return {
        subject: `Follow-up on Your HP Service Case – {{caseId}}`,
        body: `Hi {{customerName}},

I hope you are doing well.

This email is in reference to Case Number: {{caseId}}.

We have received an update confirming that your device has been delivered back to you after the repair was completed at our service center.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}
• Delivery Details: {{trackingStatus}}

We attempted to contact you to confirm delivery and to check whether the device is functioning as expected;
however, we were unable to reach you.

Kindly provide us with an update so that we may proceed accordingly. 
If the issue persists or if you require any further assistance, please feel free to let us know—we will be glad to help.

You may also contact our HP support helpline if you require immediate assistance.

Thank you for choosing HP.

Kind regards,
{{agentFirstName}}
HP Inc.`
      };
    }

    if (caseResolutionCode === "Parts Shipped") {
      return {
        subject: `Follow-up on Your HP Service Case – {{caseId}}`,
        body: `Hi {{customerName}},

I hope you are doing well.

This email is in reference to Case Number: {{caseId}}.

We have received an update confirming that the replacement part listed below has been successfully delivered.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}

Part Details:
• Part Name: {{partName}}
• Part Number: {{partNumber}}
• Delivery Details: {{trackingStatus}}

We attempted to contact you to confirm delivery and to check whether the device is functioning as expected after the replacement; 
however, we were unable to reach you.

Kindly provide us with an update so that we may proceed accordingly. 
If the issue persists or if you require any assistance, please feel free to let us know—we will be glad to help.

You may also contact our HP support helpline if you require immediate assistance.

Thank you for choosing HP.

Kind regards,
{{agentFirstName}}
HP Inc.`
      };
    }

    return null;
  }

},

  ncm2: {
    subject: "NCM 2 Update",
    body: `NCM 2 Template`
  },

  closure: {
    subject: "Case Closure",
    body: `Closure Template`
  },

  confirmation: {
    subject: "Confirmation",
    body: `Confirmation Template`
  },
  
  unresolved: {
    subject: "Unresolved Case",
    body: `Unresolved Template`
  }

  /* templates */

};
