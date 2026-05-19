declare module 'elo-rating' {
  interface EloRatingResult {
    playerRating: number;
    opponentRating: number;
  }

  const EloRating: {
    calculate(playerRating: number, opponentRating: number, playerWon: boolean, kFactor?: number): EloRatingResult;
  };

  export default EloRating;
}
