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

  getTemplate(caseData) {

    const { caseResolutionCode, benchRFC } = caseData;

    if (caseResolutionCode === "Onsite Solution") {
      return {
        subject: `Follow-up on Your HP Service Case – {{caseId}}`,
        body: `Hi {{customerName}},

I hope you are doing well.

This email is in reference to Case Number: {{caseId}}.

We previously attempted to contact you to confirm whether the device listed below is functioning properly after the onsite repair; 
however, we were unable to reach you. We had also shared a previous email requesting an update but have not received a response.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}

As we have not received an update regarding the current status of the device, 
we will consider the issue to be resolved and proceed with closing the case by tomorrow.

If the issue still persists or if you require any further assistance, 
please reply to this email or contact our HP support helpline so that we can assist you further and avoid case closure.

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

This email is in reference to Case Number: {{caseId}}.

A pickup service had previously been arranged for the device listed below; 
however, the unit could not be collected due to multiple unsuccessful pickup attempts.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}

We previously attempted to contact you and also shared an email requesting confirmation on whether you would still like to proceed with the repair service 
or if the issue has already been resolved. However, we have not received any response.

As we have not received an update, we will consider the issue to be resolved and proceed with closing the case by tomorrow.

If you still require assistance or would like to proceed with the repair service, 
please reply to this email or contact our HP support helpline so that we can assist you further and avoid case closure.

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

We previously attempted to contact you to confirm whether the device listed below is functioning properly after being returned to you from our service center. 
However, we were unable to reach you, and we have not received a response to our previous email.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}
• Delivery Details: {{trackingStatus}}

As we have not received an update regarding the current status of the device, 
we will consider the issue to be resolved and proceed with closing the case by tomorrow.

If the issue still persists or if you require any further assistance, 
please reply to this email or contact our HP support helpline so that we can assist you further and avoid case closure.

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

We previously attempted to contact you to confirm whether the replacement part delivered for the device listed below has resolved the reported issue. 
However, we were unable to reach you, and we have not received a response to our previous email.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}

Part Details:
• Part Name: {{partName}}
• Part Number: {{partNumber}}
• Delivery Details: {{trackingStatus}}

As we have not received an update regarding the current status of the device, 
we will consider the issue to be resolved and proceed with closing the case by tomorrow.

If the issue still persists or if you require any further assistance, 
please reply to this email or contact our HP support helpline so that we can assist you further and avoid case closure.

Thank you for choosing HP.

Kind regards,
{{agentFirstName}}
HP Inc.`
      };
    }

    return null;
  }

},

closure: {

  getTemplate(caseData) {

    const { caseResolutionCode, benchRFC } = caseData;

    if (caseResolutionCode === "Onsite Solution") {
      return {
        subject: `Follow-up on Your HP Service Case – {{caseId}}`,
        body: `Hi {{customerName}},

I hope you are doing well.

This email is in reference to Case Number: {{caseId}}.

We had previously attempted to contact you multiple times to confirm whether the device listed below is functioning properly after the onsite repair; 
however, we were unable to reach you and have not received any response to our previous communications.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}

As we have not received any update regarding the current status of the device, we are proceeding with closing the case.

If you require any further assistance in the future regarding this issue or any other HP product, 
please feel free to contact our HP support helpline and reference the same case number. 
Our support team will be glad to assist you.

Please note: This case will no longer be actively monitored after closure. 
If you require assistance, we recommend contacting our support helpline for immediate support.

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

This email is in reference to Case Number: {{caseId}}.

A pickup service had previously been arranged for the device listed below; 
however, the unit could not be collected due to multiple unsuccessful pickup attempts.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}

We had attempted to contact you to confirm whether you would still like to proceed with the repair service or if the issue has already been resolved. 
As we have not received any response to our previous communications, we are proceeding with closing the case.

If you require any further assistance in the future regarding this issue or any other HP product, 
please feel free to contact our HP support helpline and reference the same case number. 
Our support team will be glad to assist you.

Please note: This case will no longer be actively monitored after closure. 
If you require assistance, we recommend contacting our support helpline for immediate support.

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

We had previously attempted to contact you to confirm whether the device listed below is functioning properly after being returned to you from our service center. 
However, we were unable to reach you and have not received any response to our previous communications.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}
• Delivery Details: {{trackingStatus}}

As we have not received any update regarding the status of the device, we are proceeding with closing the case.

If you require any further assistance in the future regarding this issue or any other HP product, 
please feel free to contact our HP support helpline and reference the same case number. 
Our support team will be glad to assist you.

Please note: This case will no longer be actively monitored after closure. 
If you require assistance, we recommend contacting our support helpline for immediate support.

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

We had previously attempted to contact you to confirm whether the replacement part delivered for the device listed below has resolved the reported issue; 
however, we were unable to reach you and have not received any response to our previous communications.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}

Part Details:
• Part Name: {{partName}}
• Part Number: {{partNumber}}
• Delivery Details: {{trackingStatus}}

As we have not received any update regarding the status of the device, we are proceeding with closing the case.

If you require any further assistance in the future regarding this issue or any other HP product, 
please feel free to contact our HP support helpline and reference the same case number. 
Our support team will be glad to assist you.

Please note: This case will no longer be actively monitored after closure. 
If you require assistance, we recommend contacting our support helpline for immediate support.

Thank you for choosing HP.

Kind regards,
{{agentFirstName}}
HP Inc.`
      };
    }

    return null;
  }

},

confirmation: {

  getTemplate(caseData) {

    const { caseResolutionCode } = caseData;

    if (caseResolutionCode === "Onsite Solution") {
      return {
        subject: `Follow-up on Your HP Service Case – {{caseId}}`,
        body: `Hi {{customerName}},

I hope you are doing well.

This email is in reference to Case Number: {{caseId}}.

As discussed over the phone, we received an update that the repair on the device listed below has been completed.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}

Kindly confirm whether the issue you reported with your HP device has been resolved 
or if you require any further assistance from our support team.

If you require any further assistance with any HP product in the future, 
please feel free to reach out and we will be glad to help.

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

As discussed over the phone, we received an update that the device listed below has been repaired and returned from our service center.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}
• Delivery Details: {{trackingStatus}}

Kindly confirm whether the issue you reported with your HP device has been resolved 
or if you require any further assistance from our support team.

If you require any further assistance with any HP product in the future, 
please feel free to reach out and we will be glad to help.

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

As discussed over the phone, we received an update that the replacement part listed below has been delivered.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}

Part Details:
• Part Name: {{partName}}
• Part Number: {{partNumber}}
• Delivery Details: {{trackingStatus}}

Kindly confirm whether the issue you reported with your HP device has been resolved after the replacement 
or if you require any further assistance from our support team.

If you require any further assistance with any HP product in the future, 
please feel free to reach out and we will be glad to help.

Thank you for choosing HP.

Kind regards,
{{agentFirstName}}
HP Inc.`
      };
    }

    return null;
  }

},
  
unresolved: {

  getTemplate(caseData) {

    return {
      subject: `Follow-up on Your HP Service Case – {{caseId}}`,
      body: `Hi {{customerName}},

I hope you are doing well.

This email is in reference to Case Number: {{caseId}}.

We attempted to contact you on the phone number registered with the case; 
however, we were unable to reach you.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}

We would like to confirm whether the concern you reported with your HP device has already been resolved 
or if you still require assistance from our support team.

If you still require support, please reply to this email or contact our HP support helpline so that we can assist you further.

If the issue has already been resolved, kindly let us know so that we may proceed accordingly with the case.

Thank you for choosing HP.

Kind regards,
{{agentFirstName}}
HP Inc.`
    };

  }

},

  /* templates */

};
