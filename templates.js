function appendCustomerCalls(body, caseId) {
  try {
    const stored = localStorage.getItem("kciContactData");
    if (!stored) return body;

    const data = JSON.parse(stored);
    const normalizedId = String(caseId || "").trim();
    const contact = data[normalizedId];

    if (!contact || !contact.phones || contact.phones.length === 0) {
      return body;
    }

    const callLines = contact.phones
      .map(phone => `- Called customer on ${phone}`)
      .join("\n\n");

    return body.replace(/-\s*$/, callLines) || body + "\n" + callLines;

  } catch (e) {
    console.error("Error appending customer calls", e);
    return body;
  }
}

/* ---------- templates ---------- */
export const templates = {

kci: {

  getTemplate(caseData) {

    const {
      caseResolutionCode,
      onsiteRFC,
      benchRFC,
      csrRFC,
      trackingStatus,
      productName,
      serialNumber,
      partName,
      woClosureNotes,
      dnap
    } = caseData;

    /* =========================
       ONSITE SOLUTION
    ========================= */

    if (caseResolutionCode === "Onsite Solution") {

      if (
        onsiteRFC === "Open - Completed" ||
        onsiteRFC === "Closed - Posted"
      ) {
        const body = `-- KCI Notes

- Product Name: {{productName}}
- Serial Number: {{serialNumber}}
- WO Status: {{onsiteRFC}}

- WO Closure Notes:
{{woClosureNotes}}

-`;

        return {
          body: appendCustomerCalls(body, caseData.id)
        };
      }

      if (onsiteRFC === "Closed - Canceled") {
        const body = `-- KCI Notes

- Product Name: {{productName}}
- Serial Number: {{serialNumber}}
- WO Status: {{onsiteRFC}}

-`;

        return {
          body: appendCustomerCalls(body, caseData.id)
        };
      }

      const body = `-- KCI Notes

- Product Name: {{productName}}
- Serial Number: {{serialNumber}}
- WO Status: {{onsiteRFC}}

-`;

      return {
        body: appendCustomerCalls(body, caseData.id)
      };
    }

    /* =========================
       OFFSITE SOLUTION
    ========================= */

    if (caseResolutionCode === "Offsite Solution") {

      // ❌ DO NOT MODIFY DNAP
      if (dnap) {
        return {
          body: `-- KCI Notes

- Product Name: {{productName}}
- Serial Number: {{serialNumber}}
- CSO Status: {{benchRFC}}
- Delivery Status: {{trackingStatus}}

- Quote Rejected
- Unit returned unrepaired to customer
- Moving case for closure as DNAP`
        };
      }

      if (benchRFC === "Delivered") {
        const body = `-- KCI Notes

- Product Name: {{productName}}
- Serial Number: {{serialNumber}}
- CSO Status: {{benchRFC}}
- Delivery Status: {{trackingStatus}}

-`;

        return {
          body: appendCustomerCalls(body, caseData.id)
        };
      }

      if (benchRFC === "Order cancelled, not to be reopened") {
        const body = `-- KCI Notes

- Product Name: {{productName}}
- Serial Number: {{serialNumber}}
- CSO Status: {{benchRFC}}

-`;

        return {
          body: appendCustomerCalls(body, caseData.id)
        };
      }

      const body = `-- KCI Notes

- Product Name: {{productName}}
- Serial Number: {{serialNumber}}
- CSO Status: {{benchRFC}}

-`;

      return {
        body: appendCustomerCalls(body, caseData.id)
      };
    }

    /* =========================
       PARTS SHIPPED
    ========================= */

    if (caseResolutionCode === "Parts Shipped") {

      if (csrRFC === "POD" || csrRFC === "Closed") {
        const body = `-- KCI Notes

- Product Name: {{productName}}
- Serial Number: {{serialNumber}}

- Part Name: {{partName}}
- MO Status: {{csrRFC}}
- Delivery Status: {{trackingStatus}}

-`;

        return {
          body: appendCustomerCalls(body, caseData.id)
        };
      }

      if (csrRFC === "Cancelled") {
        const body = `-- KCI Notes

- Product Name: {{productName}}
- Serial Number: {{serialNumber}}

- Part Name: {{partName}}
- MO Status: {{csrRFC}}

-`;

        return {
          body: appendCustomerCalls(body, caseData.id)
        };
      }

      const body = `-- KCI Notes

- Product Name: {{productName}}
- Serial Number: {{serialNumber}}

- Part Name: {{partName}}
- MO Status: {{csrRFC}}

-`;

      return {
        body: appendCustomerCalls(body, caseData.id)
      };
    }

    return null;

  }

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

pod: {

  getTemplate(caseData) {

    const { caseResolutionCode } = caseData;

    /* =========================
       OFFSITE SOLUTION
    ========================= */

    if (caseResolutionCode === "Offsite Solution") {
      return {
        subject: `Proof of Delivery – HP Case {{caseId}}`,
        body: `Hi {{customerName}},

Thank you for your email.

This email is in reference to Case Number: {{caseId}}.

I have reverified the service records, and according to the logistics update, 
the device listed below was delivered on {{trackingStatus}}.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}

For your reference, I have attached the proof of delivery document to this email.

Kindly review the attached document and confirm whether the device has been received at your premises.

Please feel free to reach out if you require any further assistance—we will be glad to help.

Thank you for choosing HP.

Kind regards,
{{agentFirstName}}
HP Inc.`
      };
    }

    /* =========================
       PARTS SHIPPED
    ========================= */

    if (caseResolutionCode === "Parts Shipped") {
      return {
        subject: `Proof of Delivery – HP Case {{caseId}}`,
        body: `Hi {{customerName}},

Thank you for your email.

This email is in reference to Case Number: {{caseId}}.

I have reverified the service records, and according to the logistics update, 
the replacement part listed below was delivered on {{trackingStatus}}.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}

Part Details:
• Part Name: {{partName}}
• Part Number: {{partNumber}}

For your reference, I have attached the proof of delivery document to this email.

Kindly review the attached document and confirm whether the shipment has been received at your premises.

Please feel free to reach out if you require any further assistance—we will be glad to help.

Thank you for choosing HP.

Kind regards,
{{agentFirstName}}
HP Inc.`
      };
    }

    return null;

  }

},

returnLabelUpdate: {

  getTemplate(caseData) {

    const { caseResolutionCode } = caseData;

    if (caseResolutionCode === "Parts Shipped") {

      return {
        subject: `Return Label Request – HP Case {{caseId}}`,
        body: `Hi {{customerName}},

Thank you for the update.

This email is in reference to Case Number: {{caseId}}.

We have raised a request with our logistics team to generate a new return label for the replacement part associated with the device listed below.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}

Part Details:
• Part Name: {{partName}}
• Part Number: {{partNumber}}

You will receive the return label shortly via email.

Once you receive the return label, please use the return label/reference number provided to contact the courier service 
and arrange the pickup of the old part at your convenience.

Please feel free to contact our HP support helpline if you require any further assistance.

Thank you for choosing HP.

Kind regards,
{{agentFirstName}}
HP Inc.`
      };

    }

    return null;

  }

},

returnLabelRequest: {

  getTemplate(caseData) {

    const { caseResolutionCode } = caseData;

    if (caseResolutionCode === "Parts Shipped") {

      return {
        subject: `Return Label Request – Case {{caseId}}`,
        body: `Hi Team,

This email is in reference to Case Number: {{caseId}}.

We spoke with the customer and received confirmation that they are ready to return the part associated with the case. 
However, they require a return label to proceed with the shipment.

Part Number: {{partNumber}}

Part Description: {{partName}}

RMA: 

Contact Name: {{customerName}}

Contact Phone: 

Contact Email: 

Pickup Address:

Other notes: NA

Kindly arrange a return label for the above part and share the details so that the customer can proceed with the return.

Thank you for your support.

Regards,
{{agentFirstName}}
HP Inc.`
      };

    }

    return null;

  }

},

oooClosure: {

  getTemplate(caseData) {

    return {
      subject: `Follow-up on Your HP Service Case – {{caseId}}`,
      body: `Hi {{customerName}},

I hope you are doing well.

This email is in reference to Case Number: {{caseId}}.

We previously attempted to contact you to obtain an update regarding the status of the device listed below and the support case raised for it. 
However, we were unable to reach you and received an automated response indicating that you are currently out of office.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}

As we have not received any update and are unable to keep cases open for extended periods without activity, we will proceed with closing the case.

If you require any further assistance once you are available, please feel free to contact our HP support helpline and reference the same case number. 
Our support team will be glad to assist you.

Please note: This case will no longer be actively monitored after closure. 
For any updates or immediate assistance, we recommend contacting our HP support helpline.

Thank you for choosing HP.

Kind regards,
{{agentFirstName}}
HP Inc.`
    };

  }

},

resolved: {

  getTemplate(caseData) {

    return {
      subject: `Case Resolution Confirmation – HP Case {{caseId}}`,
      body: `Hi {{customerName}},

Thank you for your update.

This email is in reference to Case Number: {{caseId}}.

We are glad to know that the issue with the device listed below has been resolved.

Product Details:
• Product Name: {{productName}}
• Serial Number: {{serialNumber}}

As per your confirmation regarding the resolution of the issue, we will proceed with closing the case.

If you require any further assistance in the future regarding this issue or any other HP product, please feel free to contact our HP support helpline and reference the same case number. 
Our support team will be glad to assist you.

Please note: This case will no longer be actively monitored after closure. 
For any updates or immediate assistance, we recommend contacting our HP support helpline.

Thank you for choosing HP.

Kind regards,
{{agentFirstName}}
HP Inc.`
    };

  }

},

};
