import { api, track, LightningElement } from "lwc";
import { constructErrorMessage } from "c/utilCommon";

import tokenHandler from "c/psElevateTokenHandler";
import getOrgDomainInfo from "@salesforce/apex/UTIL_AuraEnabledCommon.getOrgDomainInfo";

import elevateWidgetLabel from "@salesforce/label/c.commonPaymentServices";
import spinnerAltText from "@salesforce/label/c.geAssistiveSpinner";
import elevateDisableButtonLabel from "@salesforce/label/c.RD2_ElevateDisableButtonLabel";
import elevateDisabledMessage from "@salesforce/label/c.RD2_ElevateDisabledMessage";
import nextPaymentDonationDateMessage from "@salesforce/label/c.RD2_NextPaymentDonationDateInfo";
import nextACHPaymentDonationDateMessage from "@salesforce/label/c.RD2_NextACHPaymentDonationDateInfo";
import cardholderNameLabel from "@salesforce/label/c.commonCardholderName";
import elevateEnableButtonLabel from "@salesforce/label/c.RD2_ElevateEnableButtonLabel";
import updatePaymentButtonLabel from "@salesforce/label/c.commonEditPaymentInformation";
import cancelButtonLabel from "@salesforce/label/c.commonCancel";
import commonExpirationDate from "@salesforce/label/c.commonMMYY";

import { isNull } from "c/util";
import {
    ACCOUNT_HOLDER_BANK_TYPES,
    ACCOUNT_HOLDER_TYPES,
    TOKENIZE_CREDIT_CARD_EVENT_ACTION,
    TOKENIZE_ACH_EVENT_ACTION,
    DEFAULT_NAME_ON_CARD
} from "c/geConstants";

import { Rd2Service, CONTACT_DONOR_TYPE, ACCOUNT_DONOR_TYPE } from "c/rd2Service";

/***
 * @description Event name fired when the Elevate credit card widget is displayed or hidden
 * on the RD2 entry form
 */
const WIDGET_EVENT_NAME = "rd2ElevateCreditCardForm";

const DEFAULT_ACH_CODE = "WEB";

/***
 * @description Payment services Elevate credit card widget on the Recurring Donation entry form
 */
export default class rd2ElevateCreditCardForm extends LightningElement {
    labels = {
        elevateWidgetLabel,
        spinnerAltText,
        elevateDisableButtonLabel,
        elevateDisabledMessage,
        elevateEnableButtonLabel,
        cardholderNameLabel,
        updatePaymentButtonLabel,
        cancelButtonLabel,
        nextPaymentDonationDateMessage,
        nextACHPaymentDonationDateMessage,
        commonExpirationDate,
    };
    cardholderName;

    rd2Service = new Rd2Service();

    @track isLoading = true;
    @track isDisabled = false;
    @track alert = {};

    _paymentMethod;
    _nextDonationDate;
    _updatePaymentMode = false;
    enableWidgetOnPaymentMethodChange = true;

    @api rd2State;
    @api rd2RecordId;
    @api existingPaymentMethod;
    @api isEditMode;
    @api cardLastFourLabel;
    @api achLastFourLabel;

    @api payerOrganizationName;
    @api payerFirstName;
    @api payerLastName;

    @api isDigitalExperience = false;
    creditCardContainerClass = 'credit-card-container slds-var-m-top_small';
    cardInfoClass = 'slds-var-p-horizontal_small slds-var-p-top_small';

    @api
    get paymentMethod() {
        return this._paymentMethod;
    }

    set paymentMethod(value) {
        if (this.shouldNotifyIframe(value)) {
            this.notifyIframePaymentMethodChanged(value);
        }
        this._paymentMethod = value;
        this.enableWidgetOnPaymentMethodChange = true;
    }

    notifyIframePaymentMethodChanged(newValue) {
        const iframe = this.selectIframe();
        if (this.shouldEnableWidgetOnPaymentMethodChange(newValue)) {
            this.handleUserEnabledWidget();
        }
        if (!isNull(iframe)) {
            tokenHandler.setPaymentMethod(iframe, newValue, this.handleError, this.resolveMount).catch((err) => {
                this.handleError(err);
            });
        }
    }

    /**
     * When TRUE, widget does not allow user to disable it or cancel.
     * Only TRUE when this component is hosted by rd2EditPaymentInformationModal
     * @return {boolean}
     */
    @api
    get updatePaymentMode() {
        return this._updatePaymentMode;
    }

    set updatePaymentMode(value) {
        this._updatePaymentMode = value;
    }

    get currentPaymentIsCard() {
        return this.rd2Service.isCard(this.paymentMethod);
    }

    currentPaymentIsAch() {
        return this.rd2Service.isACH(this.paymentMethod);
    }

    /***
     * @description Get the Credit Card expiration date, formated as MM/YYYY
     */
    get cardExpDate() {
        const cardExpMonth = this.rd2State.cardExpirationMonth;
        const cardExpYear = this.rd2State.cardExpirationYear;
        return cardExpMonth && cardExpYear ? cardExpMonth + "/" + cardExpYear : "";
    }

    get showExistingACHInfo() {
        return this.isEditMode && this.originalPaymentMethodIsACH();
    }

    get showExistingCardInfo() {
        return this.isEditMode && this.originalPaymentMethodIsCard();
    }

    originalPaymentMethodIsACH() {
        const originalPaymentMethod = this.rd2Service.getOriginalPaymentMethod(this.rd2State);
        return this.rd2Service.isACH(originalPaymentMethod);
    }

    originalPaymentMethodIsCard() {
        const originalPaymentMethod = this.rd2Service.getOriginalPaymentMethod(this.rd2State);
        return this.rd2Service.isCard(originalPaymentMethod);
    }

    get nextPaymentDateMessage() {
        if (this.currentPaymentIsAch()) {
            return this.labels.nextACHPaymentDonationDateMessage;
        } else if (this.currentPaymentIsCard) {
            return this.labels.nextPaymentDonationDateMessage;
        }
    }

    shouldNotifyIframe(newPaymentMethod) {
        const oldPaymentMethod = this._paymentMethod ? this._paymentMethod : this.existingPaymentMethod;
        const changed = oldPaymentMethod !== undefined && oldPaymentMethod !== newPaymentMethod;
        const newMethodValidForElevate = this.rd2Service.isElevatePaymentMethod(newPaymentMethod);
        return changed && newMethodValidForElevate;
    }

    shouldEnableWidgetOnPaymentMethodChange(newPaymentMethod) {
        return this.enableWidgetOnPaymentMethodChange && this.isPaymentMethodChanged(newPaymentMethod);
    }

    @api
    get nextDonationDate() {
        const localDate = new Date(this._nextDonationDate);
        return new Date(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate());
    }

    set nextDonationDate(value) {
        this._nextDonationDate = value;
    }

    /***
     * @description Get the organization domain information such as domain and the pod name
     * in order to determine the Visualforce origin URL so that origin source can be verified.
     */
    async connectedCallback() {
        if (this.shouldLoadInDisabledMode()) {
            this.isDisabled = true;
        }

        const domainInfo = await getOrgDomainInfo().catch((error) => {
            this.handleError(error);
        });

        tokenHandler.setVisualforceOriginURLs(domainInfo);
        
        if(this.isDigitalExperience) {
            this.handleUserEnabledWidget();
            this.creditCardContainerClass = '';
            this.cardInfoClass = '';
        }
        
    }

    shouldLoadInDisabledMode() {
        if (this.updatePaymentMode) {
            return false;
        } else {
            return !this.isPaymentMethodChanged() && this.rd2RecordId;
        }
    }

    /***
     * @description Listens for a message from the Visualforce iframe.
     */
    renderedCallback() {
        let component = this;
        tokenHandler.registerPostMessageListener(component);
    }

    /***
     * @description Elevate credit card tokenization Visualforce page URL
     */
    get tokenizeCardPageUrl() {
        return tokenHandler.getTokenizeCardPageURL();
    }

    /***
     * @description Method handles messages received from Visualforce iframe wrapper.
     * @param message Message received from iframe
     */
    async handleMessage(message) {
        tokenHandler.handleMessage(message);

        if (message.isReadyToMount && !this.isMounted) {
            this.requestMount();
        }
    }

    /***
     * @description Method sends a message to the Visualforce iframe wrapper for the Elevate sdk to mount
     * the tokenization iframe.
     */
    requestMount() {
        const iframe = this.selectIframe();
        tokenHandler.mount(iframe, this.paymentMethod, this.handleError, this.resolveMount);
    }

    /***
     * @description Handles a successful response from the Elevate sdk mount request.
     */
    resolveMount = () => {
        this.isLoading = false;
        this.isMounted = true;
    };

    /***
     * @description Method sends a message to the visualforce page iframe requesting a token.
     */
    requestToken() {
        this.clearError();

        const iframe = this.selectIframe();
        if (this.rd2Service.isCard(this.paymentMethod)) {
            return this.requestCardToken(iframe);
        } else if (this.rd2Service.isACH(this.paymentMethod)) {
            return this.requestAchToken(iframe);
        }
    }

    selectIframe() {
        return this.template.querySelector(`[data-id='${this.labels.elevateWidgetLabel}']`);
    }

    requestCardToken(iframe) {
        const params = JSON.stringify(this.getCardParams());
        return tokenHandler.requestToken({
            iframe: iframe,
            tokenizeParameters: params,
            eventAction: TOKENIZE_CREDIT_CARD_EVENT_ACTION,
            handleError: this.handleError,
        });
    }

    getCardParams() {
        const cardholderName = this.cardholderName || DEFAULT_NAME_ON_CARD;
        return {
            nameOnCard: cardholderName
        };
    }

    requestAchToken(iframe) {
        const params = JSON.stringify(this.getAchParams());
        return tokenHandler.requestToken({
            iframe: iframe,
            tokenizeParameters: params,
            eventAction: TOKENIZE_ACH_EVENT_ACTION,
            handleError: this.handleError,
        });
    }

    getAchParams() {
        if (this.rd2State.donorType === CONTACT_DONOR_TYPE) {
            return {
                accountHolder: {
                    firstName: this.payerFirstName,
                    lastName: this.payerLastName,
                    type: ACCOUNT_HOLDER_TYPES.INDIVIDUAL,
                    bankType: ACCOUNT_HOLDER_BANK_TYPES.CHECKING,
                },
                achCode: DEFAULT_ACH_CODE,
                nameOnAccount: `${this.payerFirstName} ${this.payerLastName}`,
            };
        } else if (this.rd2State.donorType === ACCOUNT_DONOR_TYPE) {
            return {
                accountHolder: {
                    businessName: this.payerLastName,
                    accountName: this.payerOrganizationName,
                    type: ACCOUNT_HOLDER_TYPES.BUSINESS,
                    bankType: ACCOUNT_HOLDER_BANK_TYPES.CHECKING,
                },
                achCode: DEFAULT_ACH_CODE,
                nameOnAccount: this.payerOrganizationName,
            };
        }
    }

    isPaymentMethodChanged(newPaymentMethod) {
        const paymentMethod = newPaymentMethod ? newPaymentMethod : this.paymentMethod;
        return this.existingPaymentMethod !== paymentMethod;
    }

    /***
     * @description Handles user onclick event for disabling the widget.
     */
    handleUserDisabledWidget() {
        this.hideWidget();
        tokenHandler.dispatchApplicationEvent(WIDGET_EVENT_NAME, {
            isDisabled: true,
        });
    }

    /***
     * @description Handles user onclick event for disabling the widget.
     */
    handleUserCancelledWidget() {
        this.hideWidget();
        if (this.isPaymentMethodChanged()) {
            this.enableWidgetOnPaymentMethodChange = false;
        }
        tokenHandler.dispatchApplicationEvent(WIDGET_EVENT_NAME, {
            isDisabled: true,
        });
    }

    /***
     * @description Handles user onclick event for re-enabling the widget.
     */
    handleUserEnabledWidget() {
        this.isLoading = true;
        this.displayWidget();
        tokenHandler.dispatchApplicationEvent(WIDGET_EVENT_NAME, {
            isDisabled: false,
        });
    }

    /***
     * @description Enables or disables the widget based on provided args.
     */
    displayWidget() {
        this.isDisabled = false;
        this.clearError();
    }

    /***
     * @description Enables or disables the widget based on provided args.
     */
    hideWidget() {
        this.isDisabled = true;
        this.isMounted = false;
        this.clearError();
    }

    /**
     * Clears the error display
     */
    clearError() {
        this.alert = {};
    }

    /**
     * Handles the error from the iframe
     * @param message Error container
     * @return object Error object returned to the RD entry form
     */
    handleError = (message) => {
        let errorValue;
        let isObject = false;

        if (typeof message.error === "object") {
            errorValue = JSON.stringify(Object.values(message.error));
            isObject = true;
        } else if (typeof message.error === "string") {
            errorValue = message.error;
        } else {
            //an unexpected error has been generated
            const error = constructErrorMessage(message);
            errorValue = error ? error.detail : JSON.stringify(message);
        }

        this.alert = {
            theme: "error",
            show: true,
            message: errorValue,
            variant: "inverse",
            icon: "utility:error",
        };

        return {
            error: {
                message: errorValue,
                isObject: isObject,
            },
        };
    };

    /**
     * Handles changes made to fields in the form
     * @param event Event containing field change information
     */
    handleFieldChange(event) {
        const fieldName = event.target.name;
        const newVal = event.detail.value;
        this[fieldName] = newVal;
    }

    /**
     * Requests a payment token when the form is saved
     * @return {paymentToken: Promise<*>} Promise that will resolve to the token
     */
    @api
    returnToken() {
        return {
            payload: this.requestToken(),
        };
    }

    get qaLocatorLastFourDigits() {
        return `text Last Four Digits`;
    }

    get qaLocatorExpirationDate() {
        return `text Expiration Date`;
    }
}
