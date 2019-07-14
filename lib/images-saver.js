'use strict';

const Promise = require('bluebird');
const fs = require('fs-extra');
const reporterHelpers = require('./reporter-helpers');
const utils = require('./server-utils');
const crypto = require('crypto');

function createHash(buffer) {
    return crypto
        .createHash('sha1')
        .update(buffer)
        .digest('base64');
}

const globalCacheDiffImages = new Map();

module.exports = class ImagesSaver {
    constructor(testResult) {
        this._testResult = testResult;
    }

    setTestResult(testResult) {
        this._testResult = testResult;

        return this;
    }

    saveDiffImg(assertResult, {workers, stateName, reportPath}) {
        return Promise.all([
            this.saveCurrImg(stateName, reportPath),
            this.saveDiffInWorker(
                assertResult,
                utils.getDiffAbsolutePath(this._testResult, reportPath, stateName),
                workers
            ),
            this.saveRef(stateName, reportPath)
        ]);
    }

    saveRef(stateName, reportPath) {
        return utils.copyImageAsync(
            this._testResult.getRefImg(stateName).path,
            utils.getReferenceAbsolutePath(this._testResult, reportPath, stateName)
        );
    }

    saveCurrImg(stateName, reportPath) {
        return reporterHelpers.saveTestCurrentImage(this._testResult, reportPath, stateName);
    }

    getImagesFor(status, stateName) {
        return utils.getImagesFor(status, this._testResult, stateName);
    }

    //parallelize and cache of 'gemini-core.Image.buildDiff' (because it is very slow)
    async saveDiffInWorker(imageDiffError, destPath, workers, cacheDiffImages = globalCacheDiffImages) {
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
