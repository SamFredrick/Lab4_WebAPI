require('dotenv').config({ path: __dirname + '/.env' });
var express = require('express');
console.log("SECRET_KEY =", process.env.SECRET_KEY);
console.log("DB =", process.env.DB);

var bodyParser = require('body-parser');
var passport = require('passport');
var authJwtController = require('./auth_jwt');
var jwt = require('jsonwebtoken');
var cors = require('cors');
var User = require('./Users');
var Movie = require('./Movies');
var Review = require('./Reviews');
var mongoose = require('mongoose');

var app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(passport.initialize());

var router = express.Router();

// SIGNUP
router.post('/signup', async (req, res) => {
  if (!req.body.username || !req.body.password) {
    return res.status(400).json({ success: false, msg: 'Please include both username and password.' });
  }
  try {
    const user = new User({
      name: req.body.name,
      username: req.body.username,
      password: req.body.password,
    });
    await user.save();
    res.status(201).json({ success: true, msg: 'Successfully created new user.' });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'A user with that username already exists.' });
    }
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
});

// SIGNIN
router.post('/signin', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.body.username }).select('name username +password');
    if (!user) {
      return res.status(401).json({ success: false, msg: 'Authentication failed. User not found.' });
    }
    const isMatch = await user.comparePassword(req.body.password);
    if (isMatch) {
      const userToken = { id: user._id, username: user.username };
      const token = jwt.sign(userToken, process.env.SECRET_KEY, { expiresIn: '1h' });
      res.json({ success: true, token: 'JWT ' + token });
    } else {
      res.status(401).json({ success: false, msg: 'Authentication failed. Wrong password.' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
});

// MOVIES routes
router.route('/movies')
  .get(authJwtController.isAuthenticated, async (req, res) => {
    try {
      if (req.query.reviews === 'true') {
        const aggregate = [
          {
            $lookup: {
              from: 'reviews',
              localField: '_id',
              foreignField: 'movieId',
              as: 'movieReviews'
            }
          },
          {
            $addFields: {
              avgRating: { $avg: '$movieReviews.rating' }
            }
          },
          { $sort: { avgRating: -1 } }
        ];
        const movies = await Movie.aggregate(aggregate);
        return res.json({ success: true, movies });
      }
      const movies = await Movie.find();
      res.json({ success: true, movies });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  })
  .post(authJwtController.isAuthenticated, async (req, res) => {
    const { title, releaseDate, genre, actors, imageUrl } = req.body;
    if (!title || !releaseDate || !genre || !actors || actors.length === 0) {
      return res.status(400).json({ success: false, message: 'Missing required movie information.' });
    }
    try {
      const movie = new Movie({ title, releaseDate, genre, actors, imageUrl });
      await movie.save();
      res.status(201).json({ success: true, message: 'Movie saved.', movie });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  })
  .put(authJwtController.isAuthenticated, (req, res) => {
    res.status(405).json({ success: false, message: 'PUT not supported on /movies' });
  })
  .delete(authJwtController.isAuthenticated, (req, res) => {
    res.status(405).json({ success: false, message: 'DELETE not supported on /movies' });
  });

// MOVIES/:movieparameter routes
router.route('/movies/:movieparameter')
  .get(authJwtController.isAuthenticated, async (req, res) => {
    try {
      if (req.query.reviews === 'true') {
        const movie = await Movie.findOne({ title: req.params.movieparameter });
        if (!movie) return res.status(404).json({ success: false, message: 'Movie not found.' });

        const result = await Movie.aggregate([
          { $match: { _id: movie._id } },
          {
            $lookup: {
              from: 'reviews',
              localField: '_id',
              foreignField: 'movieId',
              as: 'reviews'
            }
          },
          {
            $addFields: {
              avgRating: { $avg: '$reviews.rating' }
            }
          }
        ]);
        return res.json({ success: true, movie: result[0] });
      }

      const movie = await Movie.findOne({ title: req.params.movieparameter });
      if (!movie) return res.status(404).json({ success: false, message: 'Movie not found.' });
      res.json({ success: true, movie });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  })
  .post(authJwtController.isAuthenticated, (req, res) => {
    res.status(405).json({ success: false, message: 'POST not supported on /movies/:movieparameter' });
  })
  .put(authJwtController.isAuthenticated, async (req, res) => {
    try {
      const movie = await Movie.findOneAndUpdate(
        { title: req.params.movieparameter },
        req.body,
        { new: true, runValidators: true }
      );
      if (!movie) return res.status(404).json({ success: false, message: 'Movie not found.' });
      res.json({ success: true, message: 'Movie updated.', movie });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  })
  .delete(authJwtController.isAuthenticated, async (req, res) => {
    try {
      const movie = await Movie.findOneAndDelete({ title: req.params.movieparameter });
      if (!movie) return res.status(404).json({ success: false, message: 'Movie not found.' });
      res.json({ success: true, message: 'Movie deleted.' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

// REVIEWS routes
router.route('/reviews')
  .get(authJwtController.isAuthenticated, async (req, res) => {
    try {
      const reviews = await Review.find();
      res.json({ success: true, reviews });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  })
  .post(authJwtController.isAuthenticated, async (req, res) => {
    const { movieId, review, rating } = req.body;
    if (!movieId || !review || rating === undefined) {
      return res.status(400).json({ success: false, message: 'Missing required review information.' });
    }
    try {
      const movie = await Movie.findById(movieId);
      if (!movie) return res.status(404).json({ success: false, message: 'Movie not found.' });

      const decoded = jwt.verify(req.headers.authorization.replace('JWT ', ''), process.env.SECRET_KEY);
      const username = decoded.username;

      const newReview = new Review({ movieId, username, review, rating });
      await newReview.save();
      res.status(201).json({ message: 'Review created!' });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  });

app.use('/', router);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = app;