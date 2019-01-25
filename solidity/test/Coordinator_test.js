import * as h from './support/helpers'
import { assertBigNum } from './support/matchers'

contract('Coordinator', () => {
  const sourcePath = 'Coordinator.sol'
  let coordinator, link

  beforeEach(async () => {
    link = await h.linkContract()
    coordinator = await h.deploy(sourcePath, link.address)
  })

  it('has a limited public interface', () => {
    h.checkPublicABI(artifacts.require(sourcePath), [
      'getPackedArguments',
      'getId',
      'oracleRequest',
      'fulfillOracleRequest',
      'getId',
      'initiateServiceAgreement',
      'onTokenTransfer',
      'serviceAgreements',
      'cancelOracleRequest'
    ])
  })

  const agreedPayment = 1
  const agreedExpiration = 2
  const endAt = h.sixMonthsFromNow()
  const agreedOracles = [
    '0x70AEc4B9CFFA7b55C0711b82DD719049d615E21d',
    '0xd26114cd6EE289AccF82350c8d8487fedB8A0C07'
  ]
  const requestDigest = '0x85820c5ec619a1f517ee6cfeff545ec0ca1a90206e1a38c47f016d4137e801dd'
  const args =
        [ agreedPayment, agreedExpiration, endAt, agreedOracles, requestDigest ]
  const expectedBinaryArgs = [
    '0x',
    ...[agreedPayment, agreedExpiration, endAt].map(h.padNumTo256Bit),
    ...agreedOracles.map(h.pad0xHexTo256Bit),
    h.strip0x(requestDigest)
  ].join('').toLowerCase()

  describe('#getPackedArguments', () => {
    it('returns the following value, given these arguments', async () => {
      const result = await coordinator.getPackedArguments.call(...args)

      assert.equal(result, expectedBinaryArgs)
    })
  })

  describe('#getId', () => {
    it('matches the ID generated by the oracle off-chain', async () => {
      const expectedBinaryArgsSha3 =
            h.keccak(expectedBinaryArgs, { encoding: 'hex' })
      const result = await coordinator.getId.call(...args)

      assert.equal(result, expectedBinaryArgsSha3)
    })
  })

  describe('#initiateServiceAgreement', () => {
    let agreement
    before(async () => {
      agreement = await h.newServiceAgreement({ oracles: [h.oracleNode] })
    })

    context('with valid oracle signatures', () => {
      it('saves a service agreement struct from the parameters', async () => {
        await h.initiateServiceAgreement(coordinator, agreement)
        await h.checkServiceAgreementPresent(coordinator, agreement)
      })

      it('returns the SAID', async () => {
        const sAID = await h.initiateServiceAgreementCall(coordinator, agreement)
        assert.equal(sAID, agreement.id)
      })

      it('logs an event', async () => {
        await h.initiateServiceAgreement(coordinator, agreement)
        const event = await h.getLatestEvent(coordinator)
        assert.equal(agreement.id, event.args.said)
      })
    })

    context('with an invalid oracle signatures', () => {
      let badOracleSignature, badRequestDigestAddr
      before(async () => {
        const sAID = h.calculateSAID(agreement)
        badOracleSignature = await h.personalSign(h.stranger, sAID)
        badRequestDigestAddr = h.recoverPersonalSignature(sAID, badOracleSignature)
        assert.equal(h.stranger.toLowerCase(), h.toHex(badRequestDigestAddr))
      })

      it('saves no service agreement struct, if signatures invalid', async () => {
        await h.assertActionThrows(
          async () => h.initiateServiceAgreement(coordinator,
            Object.assign(agreement, { oracleSignature: badOracleSignature })))
        await h.checkServiceAgreementAbsent(coordinator, agreement.id)
      })
    })

    context('Validation of service agreement deadlines', () => {
      it('Rejects a service agreement with an endAt date in the past', async () => {
        await h.assertActionThrows(
          async () => h.initiateServiceAgreement(
            coordinator,
            Object.assign(agreement, { endAt: 1 })))
        await h.checkServiceAgreementAbsent(coordinator, agreement.id)
      })
    })
  })

  describe('#oracleRequest', () => {
    const fHash = h.functionSelector('requestedBytes32(bytes32,bytes32)')
    const to = '0x80e29acb842498fe6591f020bd82766dce619d43'
    let agreement
    before(async () => {
      agreement = await h.newServiceAgreement({ oracles: [h.oracleNode] })
    })

    beforeEach(async () => {
      await h.initiateServiceAgreement(coordinator, agreement)
      await link.transfer(h.consumer, h.toWei(1000))
    })

    context('when called through the LINK token with enough payment', () => {
      let tx
      beforeEach(async () => {
        const payload = h.executeServiceAgreementBytes(
          agreement.id, to, fHash, '1', '')
        tx = await link.transferAndCall(
          coordinator.address, agreement.payment, payload, { from: h.consumer })
      })

      it('logs an event', async () => {
        const log = tx.receipt.logs[2]
        assert.equal(coordinator.address, log.address)

        // If updating this test, be sure to update
        // services.ServiceAgreementExecutionLogTopic. (Which see for the
        // calculation of this hash.)
        let eventSignature =
            '0xf3f8f8144ba3369f0ccde38cd768f1022462ce675805f3297e6274430ebbb5f0'
        assert.equal(eventSignature, log.topics[0])

        assert.equal(agreement.id, log.topics[1])
        assertBigNum(h.consumer, log.topics[2],
          "Logged consumer address doesn't match")
        assertBigNum(agreement.payment, log.topics[3],
          "Logged payment amount doesn't match")
      })
    })

    context('when called through the LINK token with not enough payment', () => {
      it('throws an error', async () => {
        const calldata = h.executeServiceAgreementBytes(agreement.id, to, fHash, '1', '')
        const underPaid = h.bigNum(agreement.payment).sub(h.bigNum(1)).toString()

        await h.assertActionThrows(async () => {
          await link.transferAndCall(
            coordinator.address, underPaid, calldata, { from: h.consumer })
        })
      })
    })

    context('when not called through the LINK token', () => {
      it('reverts', async () => {
        await h.assertActionThrows(async () => {
          await coordinator.oracleRequest(0, 0, agreement.id, to, fHash, 1, 1, '', { from: h.consumer })
        })
      })
    })
  })

  describe('#fulfillOracleRequest', () => {
    let agreement, mock, request
    beforeEach(async () => {
      agreement = await h.newServiceAgreement({ oracles: [h.oracleNode] })
      const tx = await h.initiateServiceAgreement(coordinator, agreement)
      assert.equal(tx.logs[0].args.said, agreement.id)
    })

    context('cooperative consumer', () => {
      beforeEach(async () => {
        mock = await h.deploy('examples/GetterSetter.sol')
        const fHash = h.functionSelector('requestedBytes32(bytes32,bytes32)')

        const payload = h.executeServiceAgreementBytes(agreement.id, mock.address, fHash, 1, '')
        const tx = await link.transferAndCall(
          coordinator.address, agreement.payment, payload)
        request = h.decodeRunRequest(tx.receipt.logs[2])
      })

      context('when called by a non-owner', () => {
        // Turn this test on when multiple-oracle response aggregation is enabled
        xit('raises an error', async () => {
          await h.assertActionThrows(async () => {
            await coordinator.fulfillOracleRequest(
              request.id, 'Hello World!', { from: h.stranger })
          })
        })
      })

      context('when called by an owner', () => {
        it('raises an error if the request ID does not exist', async () => {
          await h.assertActionThrows(async () => {
            await coordinator.fulfillOracleRequest(
              0xdeadbeef, 'Hello World!', { from: h.oracleNode })
          })
        })

        it('sets the value on the requested contract', async () => {
          await coordinator.fulfillOracleRequest(
            request.id, 'Hello World!', { from: h.oracleNode })

          const mockRequestId = await mock.requestId.call()
          assert.equal(request.id, mockRequestId)

          const currentValue = await mock.getBytes32.call()
          assert.equal('Hello World!', h.toUtf8(currentValue))
        })

        it('does not allow a request to be fulfilled twice', async () => {
          await coordinator.fulfillOracleRequest(request.id, 'First message!', { from: h.oracleNode })
          await h.assertActionThrows(async () => {
            await coordinator.fulfillOracleRequest(request.id, 'Second message!!', { from: h.oracleNode })
          })
        })
      })
    })

    context('with a malicious requester', () => {
      const paymentAmount = h.toWei(1)

      beforeEach(async () => {
        mock = await h.deploy('examples/MaliciousRequester.sol', link.address, coordinator.address)
        await link.transfer(mock.address, paymentAmount)
      })

      xit('cannot cancel before the expiration', async () => {
        await h.assertActionThrows(async () => {
          await mock.maliciousRequestCancel(
            agreement.id, 'doesNothing(bytes32,bytes32)')
        })
      })

      it('cannot call functions on the LINK token through callbacks', async () => {
        await h.assertActionThrows(async () => {
          await mock.request(agreement.id, link.address, 'transfer(address,uint256)')
        })
      })

      context('requester lies about amount of LINK sent', () => {
        it('the oracle uses the amount of LINK actually paid', async () => {
          const req = await mock.maliciousPrice(agreement.id)
          const amountRefunded = req.receipt.logs[3].topics[3]
          assertBigNum(paymentAmount, amountRefunded, [
            'Malicious data request tricked oracle into refunding more than',
            'the requester paid, by claiming a larger amount',
            `(${amountRefunded}) than the requester paid (${paymentAmount})`
          ].join(' '))
        })
      })
    })

    context('with a malicious consumer', () => {
      const paymentAmount = h.toWei(1)

      beforeEach(async () => {
        mock = await h.deploy('examples/MaliciousConsumer.sol', link.address, coordinator.address)
        await link.transfer(mock.address, paymentAmount)
      })

      context('fails during fulfillment', () => {
        beforeEach(async () => {
          const tx = await mock.requestData(agreement.id, 'assertFail(bytes32,bytes32)')
          request = h.decodeRunRequest(tx.receipt.logs[3])
        })

        // needs coordinator withdrawal functionality to meet parity
        xit('allows the oracle node to receive their payment', async () => {
          await coordinator.fulfillOracleRequest(request.id, 'hack the planet 101', { from: h.oracleNode })

          const balance = await link.balanceOf.call(h.oracleNode)
          assert.isTrue(balance.equals(0))

          await coordinator.withdraw(h.oracleNode, paymentAmount, { from: h.oracleNode })
          const newBalance = await link.balanceOf.call(h.oracleNode)
          assert.isTrue(paymentAmount.equals(newBalance))
        })

        it("can't fulfill the data again", async () => {
          await coordinator.fulfillOracleRequest(request.id, 'hack the planet 101', { from: h.oracleNode })
          await h.assertActionThrows(async () => {
            await coordinator.fulfillOracleRequest(request.id, 'hack the planet 102', { from: h.oracleNode })
          })
        })
      })

      context('calls selfdestruct', () => {
        beforeEach(async () => {
          const tx = await mock.requestData(agreement.id, 'doesNothing(bytes32,bytes32)')
          request = h.decodeRunRequest(tx.receipt.logs[3])
          await mock.remove()
        })

        // needs coordinator withdrawal functionality to meet parity
        xit('allows the oracle node to receive their payment', async () => {
          await coordinator.fulfillOracleRequest(request.id, 'hack the planet 101', { from: h.oracleNode })

          const balance = await link.balanceOf.call(h.oracleNode)
          assert.isTrue(balance.equals(0))

          await coordinator.withdraw(h.oracleNode, paymentAmount, { from: h.oracleNode })
          const newBalance = await link.balanceOf.call(h.oracleNode)
          assert.isTrue(paymentAmount.equals(newBalance))
        })
      })

      context('request is canceled during fulfillment', () => {
        beforeEach(async () => {
          const tx = await mock.requestData(agreement.id, 'cancelRequestOnFulfill(bytes32,bytes32)')
          request = h.decodeRunRequest(tx.receipt.logs[3])

          const mockBalance = await link.balanceOf.call(mock.address)
          assert.isTrue(mockBalance.equals(0))
        })

        // needs coordinator withdrawal functionality to meet parity
        xit('allows the oracle node to receive their payment', async () => {
          await coordinator.fulfillOracleRequest(request.id, 'hack the planet 101', { from: h.oracleNode })

          const mockBalance = await link.balanceOf.call(mock.address)
          assert.isTrue(mockBalance.equals(0))

          const balance = await link.balanceOf.call(h.oracleNode)
          assert.isTrue(balance.equals(0))

          await coordinator.withdraw(h.oracleNode, paymentAmount, { from: h.oracleNode })
          const newBalance = await link.balanceOf.call(h.oracleNode)
          assert.isTrue(paymentAmount.equals(newBalance))
        })

        it("can't fulfill the data again", async () => {
          await coordinator.fulfillOracleRequest(request.id, 'hack the planet 101', { from: h.oracleNode })
          await h.assertActionThrows(async () => {
            await coordinator.fulfillOracleRequest(request.id, 'hack the planet 102', { from: h.oracleNode })
          })
        })
      })
    })
  })
})
