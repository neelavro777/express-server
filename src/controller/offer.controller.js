const asyncHandler = require('express-async-handler');
const Offer = require("../models/offer.model");
const Chat = require("../models/chat.model");
const Message = require("../models/message.model"); 
const mongoose = require('mongoose');
const { getRecieverSocketId, io, getSenderSocketId } = require('../socket/socket');


const makeOffer = asyncHandler(async (req, res) => {
    try {
      const {price: offeredAmount, sellerId: receiverId} = req.body;
      const {productId: productID} = req.params;
      const senderId = req.user._id;  
      // const receiverId = sellerId;
      console.log("Sender ID: ", senderId, "Receiver ID: ", receiverId, "Product ID: ", productID);
      let conversation = await Chat.findOne({
        users: {$all: [senderId, receiverId]}
      });

        if (!conversation) {
            conversation = await Chat.create({
                users: [senderId, receiverId]
            });
        }
      // Create a new offer
      const newOffer = new Offer({
        product: productID,
        offerAmount: offeredAmount,
        status: 'pending'
      });
  
      // Save the offer
      await newOffer.save();
      
      await newOffer.populate({
        path: 'product',
        select: 'price _id product'
      });

      await newOffer.save()
      // Create a new message
      const newMessage = new Message({
        senderId: senderId,
        receiverId: receiverId,
        content: `Offer: Would you accept ${offeredAmount}TK for the product.`,
        offer: newOffer._id
        });

      await newMessage.save();
      
      await newMessage.populate({
        path: 'offer',
        model: 'Offer',
        populate: {
            path: 'product',
            model: 'ProductDetails'
        }
        });

      conversation.messages.push(newMessage);

      await conversation.save();

      res.status(201).json({
        message: 'Offer and message created successfully',
        data: {
            newOffer,
            newMessage
        }
      });
  
      const receiverSocketId = getRecieverSocketId(receiverId);
      console.log("New Offer: ", newOffer);
      if (receiverSocketId) {
          io.to(receiverSocketId).emit('newMessage', newMessage);
          io.to(receiverSocketId).emit('newOffer', newOffer);
      }

    } catch (error) {
      console.error(error);
      res.status(500);
      throw new Error('Error in creating offer');
    }
  });


// const getOffers = asyncHandler(async (req, res) => {
//   try {
//     const { selectedUserId: userToChatId } = req.params;
//     const senderId = req.user._id;
//     const userToChatObjectId = new mongoose.Types.ObjectId(userToChatId);

//     let messages = await Message.aggregate([
//       {
//         $match: {
//           $or: [
//             { receiverId: userToChatObjectId, senderId: senderId },
//             { receiverId: senderId, senderId: userToChatObjectId }
//           ],
//           offer: { $exists: true, $ne: null }
//         }
//       },
//       {
//         $lookup: {
//           from: 'offers', // the name of the Offer collection
//           localField: 'offer', // the field in the Message documents
//           foreignField: '_id', // the field in the Offer documents
//           as: 'offer' // the field in the output documents
//         }
//       },
//       { $unwind: '$offer' }, // flatten the offer array
//       {
//         $sort: { 'offer.offerAmount': -1 } // sort by offer amount in descending order
//       },
//       {
//         $group: {
//           _id: '$offer.product', // group by product id
//           offerAmount: { $first: '$offer.offerAmount' }, // get the first (highest) offer amount
//           product: { $first: '$offer.product' } // get the product id
//         }
//       }
//     ]);

//     if (!messages) {
//       return res.json([]);
//     }

//     // populate product details
//     console.log(messages)
//     for (let message of messages) {
//       message.product = await Product.findById(message.product).select('price product _id');
//     }

//     // map over the messages and return an object with the offer amount and the product details
//     res.json(messages.map(message => ({
//       offerAmount: message.offerAmount,
//       product: message.product
//     })));
//   } catch (error) {
//     console.error(error);
//     // handle error
//   }
// });




const getOffers = asyncHandler(async (req, res) => {
  try {
      const { selectedUserId: userToChatId } = req.params;
      const senderId = req.user._id;
      const userToChatObjectId = new mongoose.Types.ObjectId(userToChatId);
    //   console.log(senderId, userToChatObjectId);
      let messages = await Message.find({
          $or: [
            { receiverId: userToChatObjectId, senderId: senderId },
            { receiverId: senderId, senderId: userToChatObjectId }
          ],
          offer: { $exists: true, $ne: null } // only return messages that have an offer
      }).sort({ createdAt: -1 })
      .populate({
          path: 'offer',
          populate: {
              path: 'product',
              select: 'price _id product' // only return the price and _id fields
          }
      });
      
      if (!messages) {
          return res.json([]);
      }
      
      res.json(messages.map(message => ({
          offerAmount: message.offer.offerAmount,
          offerStatus: message.offer.status,
          product: message.offer.product
      })));
  } catch (error) {
      console.error(error);
      // handle error
  }
});



const deleteOffer = asyncHandler(async (req, res) => {
    try {
        const { id: offerId } = req.params;
        const objectofferId = new mongoose.Types.ObjectId(offerId);
        await Offer.deleteOne({ _id: objectofferId });
        res.status(200).json({ message: 'Offer deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error in deleting offer' });
    }
});

const updateOfferAmount = asyncHandler(async (req, res) => {
    try {
        const { offerId: offerId } = req.params;
        const { price: offerAmount } = req.body;
        const objectofferId = new mongoose.Types.ObjectId(offerId);
        const offer = await Offer.findOne({ _id: objectofferId });
        if (!offer) {
            return res.status(404).json({ message: 'Offer not found' });
        }
        offer.offerAmount = offerAmount;
        await offer.save();
        res.status(200).json(offer);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error in updating offer amount' });
    }
});

const acceptOffer = asyncHandler(async (req, res) => {
    try {
        const { offerId: offerId } = req.params;
        console.log(offerId)
        const objectofferId = new mongoose.Types.ObjectId(offerId);
        const offer = await Offer.findOne({ _id: objectofferId }).populate({path: 'product', select: 'uploadedBy _id product price'});
        console.log(offer);    
        if (!offer) {
            return res.status(404).json({ message: 'Offer not found' });
        }
        offer.status = 'accepted';
        await offer.save();
        res.status(200).json(offer);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error in accepting offer' });
    }
});

const declineOffer = asyncHandler(async (req, res) => {
    try {
        const { offerId: offerId } = req.params;
        console.log(offerId)
        const objectofferId = new mongoose.Types.ObjectId(offerId);
        const offer = await Offer.findOne({ _id: objectofferId }).populate({path: 'product', select: 'uploadedBy _id product price'});
        if (!offer) {
            return res.status(404).json({ message: 'Offer not found' });
        }
        offer.status = 'declined';
        await offer.save();
        res.status(200).json(offer);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error in declining offer' });
    }
});

module.exports = { makeOffer, getOffers, deleteOffer, updateOfferAmount, acceptOffer, declineOffer};