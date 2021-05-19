import { LightningElement, api, track } from 'lwc';
import { isNull, showToast, constructErrorMessage, isUndefined } from 'c/utilCommon';
import { HTTP_CODES } from 'c/geConstants';
import { updateRecord, getFieldValue } from 'lightning/uiRecordApi';
import paymentInformationTitle from '@salesforce/label/c.RD2_PaymentInformation';
import closeButtonLabel from '@salesforce/label/c.commonClose';
import cancelButtonLabel from '@salesforce/label/c.stgBtnCancel';
import saveButtonLabel from '@salesforce/label/c.stgBtnSave';
import spinnerAltText from '@salesforce/label/c.geAssistiveSpinner';
import loadingMessage from '@salesforce/label/c.labelMessageLoading';
import waitMessage from '@salesforce/label/c.commonWaitMessage';
import unknownError from '@salesforce/label/c.commonUnknownError';
import updateSuccessMessage from '@salesforce/label/c.RD2_EntryFormUpdateSuccessMessage';
import validatingCardMessage from '@salesforce/label/c.RD2_EntryFormSaveCreditCardValidationMessage';
import savingCommitmentMessage from '@salesforce/label/c.RD2_EntryFormSaveCommitmentMessage';
import savingRDMessage from '@salesforce/label/c.RD2_EntryFormSaveRecurringDonationMessage';
import FIELD_NAME from '@salesforce/schema/npe03__Recurring_Donation__c.Name';
import FIELD_LAST_DONATION_DATE from '@salesforce/schema/npe03__Recurring_Donation__c.npe03__Next_Payment_Date__c';
import FIELD_PAYMENT_METHOD from '@salesforce/schema/npe03__Recurring_Donation__c.PaymentMethod__c';
import FIELD_COMMITMENT_ID from '@salesforce/schema/npe03__Recurring_Donation__c.CommitmentId__c';

import RD_ACCOUNT_NAME from '@salesforce/schema/npe03__Recurring_Donation__c.npe03__Organization__r.Name';
import RD_PRIMARY_CONTACT_LAST_NAME from '@salesforce/schema/npe03__Recurring_Donation__c.npe03__Organization__r.npe01__One2OneContact__r.LastName';
import RD_CONTACT_FIRST_NAME from '@salesforce/schema/npe03__Recurring_Donation__c.npe03__Contact__r.FirstName';
import RD_CONTACT_LAST_NAME from '@salesforce/schema/npe03__Recurring_Donation__c.npe03__Contact__r.LastName';

import handleUpdatePaymentCommitment from '@salesforce/apex/RD2_EntryFormController.handleUpdatePaymentCommitment';
import logError from '@salesforce/apex/RD2_EntryFormController.logError';
import { Rd2Service } from 'c/rd2Service';

export default class rd2EditPaymentInformationModal extends LightningElement {
    @api rdRecord;
    @api accountHolderType;

    labels = Object.freeze({
        paymentInformationTitle,
        cancelButtonLabel,
        closeButtonLabel,
        saveButtonLabel,
        spinnerAltText,
        loadingMessage,
        waitMessage,
        unknownError,
        validatingCardMessage,
        savingCommitmentMessage,
        savingRDMessage,
        updateSuccessMessage
    });

    isSaving = false;
    loadingText = this.labels.loadingMessage;
    @track error = {};
    isSaveButtonDisabled = false;
    _paymentMethod;

    get contactFirstName() {
        return this.getRdValue(RD_CONTACT_FIRST_NAME);
    }

    get contactLastName() {
        return this.getRdValue(RD_CONTACT_LAST_NAME);
    }

    get organizationAccountName() {
        return this.getRdValue(RD_ACCOUNT_NAME);
    }

    rd2Service = new Rd2Service();

    /**
    * @description Dynamically render the payment edit form via CSS to show/hide based on the status of
    * the callout and saving process
    */
    get paymentEditForm() {
        return (this.isSaving)
            ? 'slds-hide'
            : '';
    }

    get paymentMethod() {
        if(!this._paymentMethod) {
            this._paymentMethod = this.existingPaymentMethod;
        }
        return this._paymentMethod;
    }

    get existingPaymentMethod() {
        return this.getValue(FIELD_PAYMENT_METHOD.fieldApiName);
    }

    get nextDonationDate() {
        return this.getValue(FIELD_LAST_DONATION_DATE.fieldApiName);
    }

    get commitmentId() {
        return this.getValue(FIELD_COMMITMENT_ID.fieldApiName);
    }

    get rdName() {
        return this.getValue(FIELD_NAME.fieldApiName);
    }

    get paymentMethodOptions() {
        return [
            { label: 'ACH', value: 'ACH' },
            { label: 'Credit Card', value: 'Credit Card' }
        ];
    }

    /**
    * @description Returns the Recurring Donation field value if the field is set and populated
    */
    getValue(fieldName) {
        return this.hasValue(fieldName)
            ? this.rdRecord.fields[fieldName].value
            : null;
    }

    getRdValue(field) {
        return getFieldValue(this.rdRecord, field);
    }

    /**
    * @description Determines if the Recurring Donation record is retrieved and
    * its fields defined and populated
    */
    hasValue(fieldName) {
        return this.rdRecord
            && this.rdRecord.fields
            && !isUndefined(this.rdRecord.fields[fieldName])
            && !isNull(this.rdRecord.fields[fieldName].value);
    }

    /**
    * @description Close the modal 
    */
    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    handlePaymentMethodChange(event) {
        this._paymentMethod = event.detail.value;
    }

    /**
    * @description Process new payment information
    */
    async handleProcessCommitment() {
        this.clearError();
        this.isSaving = true;
        this.isSaveButtonDisabled = true;

        this.loadingText = this.labels.validatingCardMessage;

        try {
            const elevateWidget = this.template.querySelector('[data-id="elevateWidget"]');

            this.paymentMethodToken = await elevateWidget.returnToken().payload;

        } catch (error) {
            this.setSaveButtonDisabled(false);
            return;
        }

        this.loadingText = this.labels.savingCommitmentMessage;

        try {
            const rd = this.rd2Service.constructRecurringDonation(this.rdRecord.id, this.commitmentId)
                .withPaymentMethod(this.paymentMethod);
            handleUpdatePaymentCommitment({
                jsonRecord: rd.asJSON(),
                paymentMethodToken: this.paymentMethodToken
            })
                .then(jsonResponse => {
                    const response = isNull(jsonResponse) ? null : JSON.parse(jsonResponse);
                    const isSuccess = isNull(response)
                        || response.statusCode === HTTP_CODES.Created
                        || response.statusCode === HTTP_CODES.OK;

                    if (isSuccess) {
                        this.loadingText = this.labels.savingRDMessage;
                        rd.withCommitmentResponseBody(response.body);
                        this.updateRecurringDonation(rd.record);

                    } else {
                        const message = this.rd2Service.getCommitmentError(response);
                        this.handleSaveError(message);
                    }
                })
                .catch((error) => {
                    this.handleSaveError(error);
                });

        } catch (error) {
            this.handleSaveError(error);
        }
    }

    /**
    * @description Use updateRecord to update Recurring Donation
    * @param fields all recurringDonation field values 
    */
    updateRecurringDonation(fields) {
        const recordInput = {fields};
        updateRecord(recordInput)
            .then(() => {
                this.handleSuccess();
            })
            .catch(error => {
                this.handleSaveError(error);
                this.handleLogError();
            });
    }

    /**
    * @description Launch a succeed toast message and closed the modal
    */
    handleSuccess() {
        const message = this.labels.updateSuccessMessage.replace("{0}", this.rdName);
        showToast(message, '', 'success');
        this.handleClose();
    }

    /***
    * @description Handle component display when an error on the save action occurs.
    * Keep Save button enabled so user can correct a value and save again.
    */
    handleSaveError(error) {
        try {
            this.error = constructErrorMessage(error); 
        } catch (error) { }

        this.setSaveButtonDisabled(false);
    }

    /***
    * @description log the error 
    */
    handleLogError() {
        logError({ recordId: this.rdRecord.id, errorMessage: this.error.detail })
            .catch((error) => { });
    }

    /**
    * @description Clears the error notification
    */
    clearError() {
        this.error = {};
    }

    /***
    * @description Handle component display when an error occurs
    * @param isDisabled: Indicates if the Save button should be disabled
    */
    setSaveButtonDisabled(isDisabled) {
        const disableBtn = !!(isDisabled && isDisabled === true);

        this.isSaving = disableBtn;
        this.isSaveButtonDisabled = disableBtn;
    }

    /**
    * @description Trap focus onto the modal when the focus reaches the top
    */
    handleClosedButtonTrapFocus(event) {
        if (event.shiftKey && event.code === 'Tab') {
            event.stopPropagation();
            this.template.querySelector('[data-id="submitButton"]').focus();
        }
    }

    /**
    * @description Trap focus onto the modal when the focus reaches the end
    */
    handleSaveButtonTrapFocus(event) {
        if (event.code === 'Tab') {
            event.stopPropagation();
            this.template.querySelector('[data-id="closeButton"]').focus();
        }
    }

    /**
     * @description Close the modal when Escape key is pressed
     */
    handleKeyUp(event) {
        if (event.keyCode === 27 || event.code === 'Escape') {
            this.handleCancel();
        }
    }
}
