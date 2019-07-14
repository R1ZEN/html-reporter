'use strict';

const Promise = require('bluebird');
const _ = require('lodash');

const TestAdapter = require('./test-adapter');
const HermioneSuiteAdapter = require('../suite-adapter/hermione-suite-adapter.js');
const {getSuitePath} = require('../plugin-utils').getHermioneUtils();
const {SUCCESS, FAIL, ERROR} = require('../constants/test-statuses');
const ImagesSaver = require('../images-saver');

module.exports = class HermioneTestResultAdapter extends TestAdapter {
    constructor(testResult, tool) {
        super(testResult);
        this._tool = tool;
        this._errors = this._tool.errors;
        this._imagesSaver = this._tool.htmlReporter.imagesSaver || new ImagesSaver();
        this._suite = HermioneSuiteAdapter.create(this._testResult);
    }

    hasDiff() {
        return this.assertViewResults.some((result) => this.isImageDiffError(result));
    }

    get assertViewResults() {
        return this._testResult.assertViewResults || [];
    }

    isImageDiffError(assertResult) {
        return assertResult instanceof this._errors.ImageDiffError;
    }

    isNoRefImageError(assertResult) {
        return assertResult instanceof this._errors.NoRefImageError;
    }

    getImagesInfo() {
        if (!_.isEmpty(this.imagesInfo)) {
            return this.imagesInfo;
        }

        this._imagesSaver.setTestResult(this);

        this.imagesInfo = this.assertViewResults.map((assertResult) => {
            let status, error;

            if (!(assertResult instanceof Error)) {
                status = SUCCESS;
            }

            if (this.isImageDiffError(assertResult)) {
                status = FAIL;
            }

            if (this.isNoRefImageError(assertResult)) {
                status = ERROR;
                error = _.pick(assertResult, ['message', 'stack']);
            }

            const {stateName, refImg, diffClusters} = assertResult;

            return _.extend(
                {stateName, refImg, status, error, diffClusters},
                this._imagesSaver.getImagesFor(status, stateName)
            );
        });

        // common screenshot on test fail
        if (this.screenshot) {
            const errorImage = _.extend(
                {status: ERROR, error: this.error},
                this._imagesSaver.getImagesFor(ERROR)
            );

            this.imagesInfo.push(errorImage);
        }

        return this.imagesInfo;
    }

    // hack which should be removed when html-reporter is able to show all assert view fails for one test
    get _firstAssertViewFail() {
        return _.find(this._testResult.assertViewResults, (result) => result instanceof Error);
    }

    get error() {
        return _.pick(this._testResult.err, ['message', 'stack', 'stateName']);
    }

    get imageDir() {
        return this._testResult.id();
    }

    get state() {
        return {name: this._testResult.title};
    }

    get attempt() {
        if (this._testResult.attempt >= 0) {
            return this._testResult.attempt;
        }

        const {retry} = this._tool.config.forBrowser(this._testResult.browserId);
        return this._testResult.retriesLeft >= 0
            ? retry - this._testResult.retriesLeft - 1
            : retry;
    }

    // for correct determine image paths in gui
    set attempt(attemptNum) {
        this._testResult.attempt = attemptNum;
    }

    get screenshot() {
        return _.get(this._testResult, 'err.screenshot');
    }

    get assertViewState() {
        return this._firstAssertViewFail
            ? _.get(this._firstAssertViewFail, 'stateName')
            : _.get(this._testResult, 'err.stateName');
    }

    get description() {
        return this._testResult.description;
    }

    get meta() {
        return this._testResult.meta;
    }

    getRefImg(stateName) {
        return _.get(_.find(this.assertViewResults, {stateName}), 'refImg', {});
    }

    getCurrImg(stateName) {
        return _.get(_.find(this.assertViewResults, {stateName}), 'currImg', {});
    }

    getErrImg() {
        return this.screenshot || {};
    }

    prepareTestResult() {
        const {title: name, browserId} = this._testResult;
        const suitePath = getSuitePath(this._testResult);

        return {name, suitePath, browserId};
    }

    get multipleTabs() {
        return true;
    }

    saveTestImages(reportPath, workers) {
        this._imagesSaver.setTestResult(this);

        return Promise.map(this.assertViewResults, (assertResult) => {
            const {stateName} = assertResult;
            const actions = [];

            if (!(assertResult instanceof Error)) {
                actions.push(this._imagesSaver.saveRef(stateName, reportPath));
            }

            if (this.isImageDiffError(assertResult)) {
                actions.push(this._imagesSaver.saveDiffImg(assertResult, {workers, stateName, reportPath}));
            }

            if (this.isNoRefImageError(assertResult)) {
                actions.push(this._imagesSaver.saveCurrImg(stateName, reportPath));
            }

            return Promise.all(actions);
        });
    }
};
