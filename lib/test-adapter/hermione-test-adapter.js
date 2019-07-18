'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const path = require('path');

const tmp = require('tmp');
const TestAdapter = require('./test-adapter');
const HermioneSuiteAdapter = require('../suite-adapter/hermione-suite-adapter.js');
const {getSuitePath} = require('../plugin-utils').getHermioneUtils();
const {SUCCESS, FAIL, ERROR} = require('../constants/test-statuses');
const utils = require('../server-utils');
const fs = require('fs-extra');
const crypto = require('crypto');

function createHash(buffer) {
    return crypto
        .createHash('sha1')
        .update(buffer)
        .digest('base64');
}

const globalCacheDiffImages = new Map();

module.exports = class HermioneTestResultAdapter extends TestAdapter {
    constructor(testResult, tool) {
        super(testResult);
        this._tool = tool;
        this._errors = this._tool.errors;
        this._suite = HermioneSuiteAdapter.create(this._testResult);
        this._externalStorage = this._tool.htmlReporter.externalStorage || {};
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
        const {baseImagesUrl} = this._externalStorage;

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
                utils.getImagesFor(status, this, {stateName, baseImagesUrl})
            );
        });

        // common screenshot on test fail
        if (this.screenshot) {
            const errorImage = _.extend(
                {status: ERROR, error: this.error},
                utils.getImagesFor(ERROR, this, {baseImagesUrl})
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
        return Promise.map(this.assertViewResults, async (assertResult) => {
            const {stateName} = assertResult;
            const reportRefPath = utils.getReferencePath(this, stateName);
            const localRefPath = this.getRefImg(stateName).path;

            const reportCurrPath = utils.getCurrentPath(this, stateName);
            const localCurrPath = this.getCurrImg(stateName).path || this.getErrImg().path;

            const reportDiffPath = utils.getDiffPath(this, stateName);
            const localDiffPath = path.resolve(tmp.tmpdir, reportDiffPath);
            const actions = [];

            if (!(assertResult instanceof Error)) {
                actions.push(this._saveImg(localRefPath, reportRefPath, reportPath));
            }

            if (this.isImageDiffError(assertResult)) {
                await this._saveDiffInWorker(assertResult, localDiffPath, workers);

                actions.push(
                    this._saveImg(localCurrPath, reportCurrPath, reportPath),
                    this._saveImg(localDiffPath, reportDiffPath, reportPath),
                    this._saveImg(localRefPath, reportRefPath, reportPath)
                );
            }

            if (this.isNoRefImageError(assertResult)) {
                actions.push(this._saveImg(localCurrPath, reportCurrPath, reportPath));
            }

            return Promise.all(actions);
        });
    }

    _saveImg(localCurrPath, reportCurrPath, reportDir) {
        const saveFn = this._externalStorage.saveImg || utils.copyImageAsync;

        return localCurrPath
            ? saveFn(localCurrPath, path.resolve(reportDir, reportCurrPath))
            : Promise.resolve();
    }

    //parallelize and cache of 'gemini-core.Image.buildDiff' (because it is very slow)
    async _saveDiffInWorker(imageDiffError, destPath, workers, cacheDiffImages = globalCacheDiffImages) {
        await utils.makeDirFor(destPath);

        const currPath = imageDiffError.currImg.path;
        const refPath = imageDiffError.refImg.path;

        const [currBuffer, refBuffer] = await Promise.all([
            fs.readFile(currPath),
            fs.readFile(refPath)
        ]);

        const hash = createHash(currBuffer) + createHash(refBuffer);

        if (cacheDiffImages.has(hash)) {
            const cachedDiffPath = cacheDiffImages.get(hash);
            await fs.copy(cachedDiffPath, destPath);
            return;
        }

        await workers.saveDiffTo(imageDiffError, destPath);

        cacheDiffImages.set(hash, destPath);
    }
};
