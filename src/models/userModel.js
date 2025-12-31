import db from "../config/db.js";

export const getAllUsers = () => {
  return new Promise((resolve, reject) => {
    db.all("SELECT id, name, email, created_at FROM users", [], (err, rows) => {
      if (err) {
        return reject(err);
      }
      resolve(rows);
    });
  });
};

export const createUser = (name, email) => {
  return new Promise((resolve, reject) => {
    const query = "INSERT INTO users (name, email) VALUES (?, ?)";
    db.run(query, [name, email], function (err) {
      if (err) {
        return reject(err);
      }
      // this.lastID is the auto-increment id
      resolve({
        id: this.lastID,
        name,
        email,
      });
    });
  });
};
